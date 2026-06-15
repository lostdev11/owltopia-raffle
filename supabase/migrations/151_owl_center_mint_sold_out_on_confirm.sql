-- Restore sell-out phase transition + mint activity logs removed in 146_public_simple_wallet_phase_limit.

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
  v_wallet_phase_minted int;
  v_network text;
  v_cm text;
  v_new_minted int;
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
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate_tx', true,
      'minted_count', v_launch.minted_count,
      'active_phase', v_launch.active_phase,
      'status', v_launch.status,
      'network', v_network
    );
  END IF;

  IF v_launch.minted_count + p_quantity > v_launch.total_supply THEN
    RETURN jsonb_build_object('ok', false, 'error', 'exceeds_supply');
  END IF;

  IF v_launch.mint_mode = 'public_simple'
     AND p_phase IN ('PRESALE', 'PRESALE_OVERAGE', 'WHITELIST', 'PUBLIC') THEN
    SELECT COALESCE(SUM(quantity), 0)::int INTO v_wallet_phase_minted
    FROM owl_center_mint_events
    WHERE launch_id = v_launch_id
      AND wallet_address = p_wallet
      AND phase = p_phase
      AND network = v_network;
    IF v_wallet_phase_minted + p_quantity > v_launch.wallet_mint_limit THEN
      RETURN jsonb_build_object('ok', false, 'error', 'wallet_mint_limit');
    END IF;
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
    IF v_launch.mint_mode <> 'public_simple' THEN
      SELECT COALESCE(SUM(quantity), 0)::int INTO v_public_minted
      FROM owl_center_mint_events
      WHERE launch_id = v_launch_id
        AND wallet_address = p_wallet
        AND phase = 'PUBLIC'
        AND network = v_network;
      IF v_public_minted + p_quantity > v_launch.wallet_mint_limit THEN
        RETURN jsonb_build_object('ok', false, 'error', 'wallet_mint_limit');
      END IF;
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
  IF v_cm IS NULL THEN
    v_cm := v_launch.candy_machine_id;
  END IF;

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

  v_new_minted := v_launch.minted_count + p_quantity;

  UPDATE owl_center_launches
  SET
    minted_count = v_new_minted,
    updated_at = now(),
    active_phase = CASE
      WHEN v_new_minted >= total_supply THEN 'SOLD_OUT'::text
      ELSE active_phase
    END,
    status = CASE
      WHEN v_new_minted >= total_supply THEN 'SOLD_OUT'::text
      ELSE status
    END
  WHERE id = v_launch_id;

  INSERT INTO owl_center_activity_logs (launch_id, message, event_type)
  VALUES (
    v_launch_id,
    CASE
      WHEN v_network = 'devnet' THEN format(
        'Devnet mint confirmed for wallet %s qty=%s phase=%s tx=%s',
        p_wallet, p_quantity, p_phase, left(p_tx_signature, 16) || '…'
      )
      ELSE format(
        'Mint confirmed for wallet %s qty=%s phase=%s tx=%s',
        p_wallet, p_quantity, p_phase, left(p_tx_signature, 16) || '…'
      )
    END,
    'mint'
  );

  IF v_new_minted >= v_launch.total_supply THEN
    INSERT INTO owl_center_activity_logs (launch_id, message, event_type)
    VALUES (
      v_launch_id,
      format('SELL_OUT supply exhausted (%s/%s)', v_new_minted, v_launch.total_supply),
      'system'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'minted_count', v_new_minted,
    'active_phase', (SELECT active_phase FROM owl_center_launches WHERE id = v_launch_id),
    'status', (SELECT status FROM owl_center_launches WHERE id = v_launch_id),
    'network', v_network
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_owl_center_gen2_mint(text, text, text, int, text, text[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_owl_center_gen2_mint(text, text, text, int, text, text[], text, text) TO service_role;
