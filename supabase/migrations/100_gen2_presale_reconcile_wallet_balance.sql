-- When each purchase row matches chain but gen2_presale_balances.purchased_mints drifted
-- (e.g. backfill inserted rows without bumping balance), repair per signature would no-op.
-- This sets purchased_mints from SUM(quantity) of confirmed purchases for the wallet.

CREATE OR REPLACE FUNCTION public.reconcile_gen2_presale_wallet_purchased_mints(p_wallet text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sum int;
  v_current int;
  v_used int;
  v_gifted int;
  v_min_purchased int;
BEGIN
  IF p_wallet IS NULL OR btrim(p_wallet) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_wallet');
  END IF;

  PERFORM pg_advisory_xact_lock(98273491);

  SELECT COALESCE(SUM(quantity), 0)::int INTO v_sum
  FROM gen2_presale_purchases
  WHERE wallet = p_wallet AND status = 'confirmed';

  SELECT purchased_mints, used_mints, gifted_mints
  INTO v_current, v_used, v_gifted
  FROM gen2_presale_balances
  WHERE wallet = p_wallet;

  IF NOT FOUND THEN
    IF v_sum <= 0 THEN
      RETURN jsonb_build_object('ok', true, 'reconciled', false, 'reason', 'no_balance_row');
    END IF;

    INSERT INTO gen2_presale_balances (wallet, purchased_mints, updated_at)
    VALUES (p_wallet, v_sum, now());

    RETURN jsonb_build_object(
      'ok', true,
      'reconciled', true,
      'previous_purchased_mints', 0,
      'new_purchased_mints', v_sum,
      'delta', v_sum
    );
  END IF;

  -- Constraint: used_mints <= purchased_mints + gifted_mints
  v_min_purchased := GREATEST(0, v_used - v_gifted);

  IF v_sum < v_min_purchased THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'purchase_sum_below_used_mints',
      'sum_from_purchases', v_sum,
      'minimum_purchased_required', v_min_purchased,
      'used_mints', v_used,
      'gifted_mints', v_gifted
    );
  END IF;

  IF v_current = v_sum THEN
    RETURN jsonb_build_object(
      'ok', true,
      'reconciled', false,
      'unchanged', true,
      'purchased_mints', v_current
    );
  END IF;

  UPDATE gen2_presale_balances
  SET purchased_mints = v_sum,
      updated_at = now()
  WHERE wallet = p_wallet;

  RETURN jsonb_build_object(
    'ok', true,
    'reconciled', true,
    'previous_purchased_mints', v_current,
    'new_purchased_mints', v_sum,
    'delta', v_sum - v_current
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_gen2_presale_wallet_purchased_mints(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reconcile_gen2_presale_wallet_purchased_mints(text) TO service_role;
