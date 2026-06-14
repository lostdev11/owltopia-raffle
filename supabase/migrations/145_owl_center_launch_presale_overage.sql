-- Per-launch presale overage (Presale+ phase) for creator collections — not Gen2-only.

CREATE TABLE IF NOT EXISTS public.owl_center_presale_overage_allocations (
  launch_id uuid NOT NULL REFERENCES public.owl_center_launches(id) ON DELETE CASCADE,
  wallet text NOT NULL,
  allowed_mints int NOT NULL DEFAULT 0,
  used_mints int NOT NULL DEFAULT 0,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (launch_id, wallet),
  CONSTRAINT owl_center_presale_overage_allowed_nonneg CHECK (allowed_mints >= 0),
  CONSTRAINT owl_center_presale_overage_used_nonneg CHECK (used_mints >= 0),
  CONSTRAINT owl_center_presale_overage_used_cap CHECK (used_mints <= allowed_mints)
);

CREATE INDEX IF NOT EXISTS idx_owl_center_presale_overage_launch
  ON public.owl_center_presale_overage_allocations (launch_id);

COMMENT ON TABLE public.owl_center_presale_overage_allocations IS
  'Wallets eligible for PRESALE_OVERAGE on a specific launch when presale credits exceed presale_supply.';

ALTER TABLE public.owl_center_presale_overage_allocations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owl_center_presale_overage_allocations TO service_role;

ALTER TABLE public.owl_center_presale_tenants
  ADD COLUMN IF NOT EXISTS launch_id uuid REFERENCES public.owl_center_launches(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_owl_center_presale_tenants_launch_id
  ON public.owl_center_presale_tenants (launch_id)
  WHERE launch_id IS NOT NULL;

COMMENT ON COLUMN public.owl_center_presale_tenants.launch_id IS
  'Optional link to owl_center_launches for per-collection presale + overage mint redemption.';

-- Hide misleading default overage on launches without a presale program.
UPDATE public.owl_center_launches
SET presale_overage_supply = 0
WHERE slug <> 'gen2'
  AND NOT creator_presale_enabled
  AND presale_supply <= 0;

CREATE OR REPLACE FUNCTION public.use_owl_center_presale_mints(
  p_launch_id uuid,
  p_wallet text,
  p_quantity int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;

  SELECT id INTO v_tenant_id
  FROM public.owl_center_presale_tenants
  WHERE launch_id = p_launch_id AND is_enabled = true
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'no_presale_tenant';
  END IF;

  UPDATE public.owl_center_presale_balances
  SET used_mints = used_mints + p_quantity,
      updated_at = now()
  WHERE tenant_id = v_tenant_id
    AND wallet = p_wallet
    AND (purchased_mints + gifted_mints - used_mints) >= p_quantity;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient_presale_balance';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.use_owl_center_presale_mints(uuid, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.use_owl_center_presale_mints(uuid, text, int) TO service_role;

DROP FUNCTION IF EXISTS public.confirm_owl_center_gen2_mint(text, text, text, int, text, text[], text, text);

CREATE OR REPLACE FUNCTION public.confirm_owl_center_gen2_mint(
  p_launch_slug text,
  p_wallet text,
  p_tx_signature text,
  p_quantity int,
  p_phase text,
  p_minted_nft_mints text[],
  p_network text DEFAULT 'mainnet',
  p_event_candy_machine_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_launch owl_center_launches%ROWTYPE;
  v_launch_id uuid;
  v_public_minted int;
  v_presale_minted int;
  v_overage_minted int;
  v_network text;
  v_cm text;
BEGIN
  v_network := lower(trim(coalesce(p_network, 'mainnet')));
  IF v_network NOT IN ('devnet', 'mainnet') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_network');
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_quantity');
  END IF;

  IF p_phase NOT IN (
    'AIRDROP', 'PRESALE', 'PRESALE_OVERAGE', 'WHITELIST', 'PUBLIC', 'SOLD_OUT', 'TRADING_ACTIVE'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_phase');
  END IF;

  PERFORM pg_advisory_xact_lock(98273492, hashtext('owl_center:' || p_launch_slug));

  SELECT * INTO v_launch FROM owl_center_launches WHERE slug = p_launch_slug FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'launch_not_found');
  END IF;

  v_launch_id := v_launch.id;

  IF v_launch.is_paused THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mint_paused');
  END IF;

  IF v_launch.active_phase IN ('SOLD_OUT', 'TRADING_ACTIVE') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mint_closed');
  END IF;

  IF p_phase <> v_launch.active_phase THEN
    RETURN jsonb_build_object('ok', false, 'error', 'phase_mismatch');
  END IF;

  IF EXISTS (
    SELECT 1 FROM owl_center_mint_events
    WHERE tx_signature = p_tx_signature AND network = v_network
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'duplicate_tx');
  END IF;

  IF v_launch.minted_count + p_quantity > v_launch.total_supply THEN
    RETURN jsonb_build_object('ok', false, 'error', 'exceeds_supply');
  END IF;

  IF p_phase = 'PRESALE' THEN
    SELECT COALESCE(SUM(quantity), 0)::int INTO v_presale_minted
    FROM owl_center_mint_events
    WHERE launch_id = v_launch_id AND phase = 'PRESALE' AND network = v_network;
    IF v_presale_minted + p_quantity > v_launch.presale_supply THEN
      RETURN jsonb_build_object('ok', false, 'error', 'presale_pool_exhausted');
    END IF;
    IF v_launch.slug = 'gen2' THEN
      PERFORM public.use_gen2_presale_mints(p_wallet, p_quantity);
    ELSE
      PERFORM public.use_owl_center_presale_mints(v_launch_id, p_wallet, p_quantity);
    END IF;
  ELSIF p_phase = 'PRESALE_OVERAGE' THEN
    SELECT COALESCE(SUM(quantity), 0)::int INTO v_overage_minted
    FROM owl_center_mint_events
    WHERE launch_id = v_launch_id AND phase = 'PRESALE_OVERAGE' AND network = v_network;
    IF v_overage_minted + p_quantity > v_launch.presale_overage_supply THEN
      RETURN jsonb_build_object('ok', false, 'error', 'overage_pool_exhausted');
    END IF;
    IF v_launch.slug = 'gen2' THEN
      UPDATE public.gen2_presale_overage_allocations
      SET used_mints = used_mints + p_quantity,
          updated_at = now()
      WHERE wallet = p_wallet
        AND (allowed_mints - used_mints) >= p_quantity;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'insufficient_overage_allocation');
      END IF;
      PERFORM public.use_gen2_presale_mints(p_wallet, p_quantity);
    ELSE
      UPDATE public.owl_center_presale_overage_allocations
      SET used_mints = used_mints + p_quantity,
          updated_at = now()
      WHERE launch_id = v_launch_id
        AND wallet = p_wallet
        AND (allowed_mints - used_mints) >= p_quantity;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'insufficient_overage_allocation');
      END IF;
      PERFORM public.use_owl_center_presale_mints(v_launch_id, p_wallet, p_quantity);
    END IF;
  ELSIF p_phase = 'WHITELIST' THEN
    SELECT COALESCE(SUM(quantity), 0)::int INTO v_public_minted
    FROM owl_center_mint_events
    WHERE launch_id = v_launch_id AND phase = 'WHITELIST' AND network = v_network;
    IF v_public_minted + p_quantity > v_launch.wl_supply THEN
      RETURN jsonb_build_object('ok', false, 'error', 'wl_pool_exhausted');
    END IF;
    UPDATE owl_center_wl_allocations
    SET used_mints = used_mints + p_quantity,
        updated_at = now()
    WHERE wallet = p_wallet
      AND (allowed_mints - used_mints) >= p_quantity;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient_wl_allocation');
    END IF;
  ELSIF p_phase = 'PUBLIC' THEN
    SELECT COALESCE(SUM(quantity), 0)::int INTO v_public_minted
    FROM owl_center_mint_events
    WHERE launch_id = v_launch_id
      AND wallet_address = p_wallet
      AND phase = 'PUBLIC'
      AND network = v_network;
    IF v_public_minted + p_quantity > v_launch.wallet_mint_limit THEN
      RETURN jsonb_build_object('ok', false, 'error', 'wallet_mint_limit');
    END IF;
  ELSIF p_phase = 'AIRDROP' THEN
    SELECT COALESCE(SUM(quantity), 0)::int INTO v_public_minted
    FROM owl_center_mint_events
    WHERE launch_id = v_launch_id
      AND phase = 'AIRDROP'
      AND network = v_network;
    IF v_public_minted + p_quantity > v_launch.airdrop_supply THEN
      RETURN jsonb_build_object('ok', false, 'error', 'exceeds_supply');
    END IF;
  END IF;

  v_cm := nullif(trim(coalesce(p_event_candy_machine_id, '')), '');

  INSERT INTO owl_center_mint_events (
    launch_id,
    wallet_address,
    quantity,
    phase,
    tx_signature,
    minted_nft_mints,
    network,
    candy_machine_id
  ) VALUES (
    v_launch_id,
    p_wallet,
    p_quantity,
    p_phase,
    p_tx_signature,
    coalesce(p_minted_nft_mints, '{}'),
    v_network,
    v_cm
  );

  UPDATE owl_center_launches
  SET minted_count = minted_count + p_quantity,
      updated_at = now()
  WHERE id = v_launch_id;

  RETURN jsonb_build_object('ok', true, 'minted_count', v_launch.minted_count + p_quantity);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_owl_center_gen2_mint(text, text, text, int, text, text[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_owl_center_gen2_mint(text, text, text, int, text, text[], text, text) TO service_role;
