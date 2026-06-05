-- Owl Center: mint event network (devnet vs mainnet), devnet CM fields on launch, confirm RPC updates.

-- Mint events: network column + composite unique on (network, tx_signature)
ALTER TABLE owl_center_mint_events
  ADD COLUMN IF NOT EXISTS network text NOT NULL DEFAULT 'mainnet';

ALTER TABLE owl_center_mint_events
  DROP CONSTRAINT IF EXISTS owl_center_mint_events_tx_unique;

ALTER TABLE owl_center_mint_events
  ADD CONSTRAINT owl_center_mint_events_network_check CHECK (network IN ('devnet', 'mainnet'));

ALTER TABLE owl_center_mint_events
  ADD CONSTRAINT owl_center_mint_events_network_tx_unique UNIQUE (network, tx_signature);

CREATE INDEX IF NOT EXISTS idx_owl_center_mint_events_network ON owl_center_mint_events (network);

-- Launch: optional devnet CM IDs (admin UI); production CM stays in candy_machine_id / env mainnet vars.
ALTER TABLE owl_center_launches
  ADD COLUMN IF NOT EXISTS devnet_candy_machine_id text;

ALTER TABLE owl_center_launches
  ADD COLUMN IF NOT EXISTS devnet_collection_mint text;

COMMENT ON COLUMN owl_center_launches.devnet_candy_machine_id IS 'Devnet Candy Machine V3 address for isolated proof-of-mint; does not replace mainnet candy_machine_id.';
COMMENT ON COLUMN owl_center_launches.devnet_collection_mint IS 'Devnet collection mint for CM proof-of-mint.';

-- Replace confirm RPC (adds network + optional candy machine id for verified mint row)
DROP FUNCTION IF EXISTS public.confirm_owl_center_gen2_mint(text, text, text, int, text, text[]);

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

  IF p_phase NOT IN ('AIRDROP', 'PRESALE', 'WHITELIST', 'PUBLIC', 'SOLD_OUT', 'TRADING_ACTIVE') THEN
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
    PERFORM public.use_gen2_presale_mints(p_wallet, p_quantity);
  ELSIF p_phase = 'WHITELIST' THEN
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
      AND wallet_address = p_wallet
      AND phase = 'AIRDROP'
      AND network = v_network;
    IF v_public_minted + p_quantity > v_launch.wallet_mint_limit THEN
      RETURN jsonb_build_object('ok', false, 'error', 'wallet_mint_limit');
    END IF;
  END IF;

  v_cm := nullif(trim(coalesce(p_event_candy_machine_id, '')), '');
  IF v_cm IS NULL THEN
    v_cm := v_launch.candy_machine_id;
  END IF;

  INSERT INTO owl_center_mint_events (
    launch_id,
    wallet_address,
    quantity,
    tx_signature,
    phase,
    candy_machine_id,
    minted_nft_mints,
    network
  ) VALUES (
    v_launch_id,
    p_wallet,
    p_quantity,
    p_tx_signature,
    p_phase,
    v_cm,
    p_minted_nft_mints,
    v_network
  );

  UPDATE owl_center_launches
  SET
    minted_count = minted_count + p_quantity,
    updated_at = now(),
    active_phase = CASE
      WHEN minted_count + p_quantity >= total_supply THEN 'SOLD_OUT'::text
      ELSE active_phase
    END,
    status = CASE
      WHEN minted_count + p_quantity >= total_supply THEN 'SOLD_OUT'::text
      ELSE status
    END
  WHERE id = v_launch_id;

  INSERT INTO owl_center_activity_logs (launch_id, message, event_type)
  VALUES (
    v_launch_id,
    CASE
      WHEN v_network = 'devnet' THEN format('Devnet mint confirmed for wallet %s qty=%s phase=%s tx=%s', p_wallet, p_quantity, p_phase, left(p_tx_signature, 16) || '…')
      ELSE format('Mint confirmed for wallet %s qty=%s phase=%s tx=%s', p_wallet, p_quantity, p_phase, left(p_tx_signature, 16) || '…')
    END,
    'mint'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'minted_count', (SELECT minted_count FROM owl_center_launches WHERE id = v_launch_id),
    'active_phase', (SELECT active_phase FROM owl_center_launches WHERE id = v_launch_id),
    'status', (SELECT status FROM owl_center_launches WHERE id = v_launch_id),
    'network', v_network
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_owl_center_gen2_mint(text, text, text, int, text, text[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_owl_center_gen2_mint(text, text, text, int, text, text[], text, text) TO service_role;

-- Testing helper: reset presale used_mints to 0 (admin-only RPC; credits unchanged)
CREATE OR REPLACE FUNCTION public.admin_reset_gen2_presale_used_mints(p_wallet text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row gen2_presale_balances%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM gen2_presale_balances WHERE wallet = p_wallet FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_not_found');
  END IF;

  UPDATE gen2_presale_balances
  SET used_mints = 0, updated_at = now()
  WHERE wallet = p_wallet;

  RETURN jsonb_build_object('ok', true, 'wallet', p_wallet, 'used_mints', 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_gen2_presale_used_mints(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_gen2_presale_used_mints(text) TO service_role;

COMMENT ON FUNCTION public.admin_reset_gen2_presale_used_mints IS 'Service-role only: zero presale used_mints for devnet retesting; does not remove purchased/gifted credits.';
