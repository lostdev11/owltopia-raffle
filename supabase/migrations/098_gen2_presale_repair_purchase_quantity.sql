-- Repair a gen2 presale row when quantity / lamports were recorded incorrectly (e.g. old backfill bug).
-- Applies delta to purchased_mints and updates purchase row atomically with oversell + balance checks.

CREATE OR REPLACE FUNCTION public.repair_gen2_presale_purchase_quantity(
  p_tx_signature text,
  p_wallet text,
  p_new_quantity int,
  p_unit_price_usdc numeric,
  p_sol_usd_price numeric,
  p_total_lamports bigint,
  p_founder_a_lamports bigint,
  p_founder_b_lamports bigint,
  p_presale_supply int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_qty int;
  v_row_wallet text;
  v_delta int;
  v_total_sold int;
BEGIN
  IF p_new_quantity <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_quantity');
  END IF;

  PERFORM pg_advisory_xact_lock(98273491);

  SELECT quantity, wallet INTO v_old_qty, v_row_wallet
  FROM gen2_presale_purchases
  WHERE tx_signature = p_tx_signature
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_row_wallet <> p_wallet THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wallet_mismatch');
  END IF;

  IF v_old_qty = p_new_quantity THEN
    RETURN jsonb_build_object(
      'ok', true,
      'unchanged', true,
      'quantity', v_old_qty
    );
  END IF;

  SELECT COALESCE(SUM(quantity), 0)::int INTO v_total_sold
  FROM gen2_presale_purchases
  WHERE status = 'confirmed';

  IF v_total_sold - v_old_qty + p_new_quantity > p_presale_supply THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sold_out');
  END IF;

  v_delta := p_new_quantity - v_old_qty;

  UPDATE gen2_presale_purchases
  SET
    quantity = p_new_quantity,
    unit_price_usdc = p_unit_price_usdc,
    sol_usd_price = p_sol_usd_price,
    total_lamports = p_total_lamports,
    founder_a_lamports = p_founder_a_lamports,
    founder_b_lamports = p_founder_b_lamports
  WHERE tx_signature = p_tx_signature;

  INSERT INTO gen2_presale_balances (wallet, purchased_mints, updated_at)
  VALUES (p_wallet, v_delta, now())
  ON CONFLICT (wallet) DO UPDATE SET
    purchased_mints = gen2_presale_balances.purchased_mints + v_delta,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'unchanged', false,
    'previous_quantity', v_old_qty,
    'quantity', p_new_quantity,
    'delta', v_delta
  );
END;
$$;

REVOKE ALL ON FUNCTION public.repair_gen2_presale_purchase_quantity(
  text, text, int, numeric, numeric, bigint, bigint, bigint, int
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.repair_gen2_presale_purchase_quantity(
  text, text, int, numeric, numeric, bigint, bigint, bigint, int
) TO service_role;
