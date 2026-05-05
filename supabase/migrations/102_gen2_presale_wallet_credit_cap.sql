-- Cap total presale credits per wallet (purchased_mints + gifted_mints) at 20.
-- Must match GEN2_PRESALE_MAX_CREDITS_PER_WALLET in lib/gen2-presale/max-per-purchase.ts

CREATE OR REPLACE FUNCTION public.confirm_gen2_presale_purchase(
  p_wallet text,
  p_quantity int,
  p_unit_price_usdc numeric,
  p_sol_usd_price numeric,
  p_total_lamports bigint,
  p_founder_a_lamports bigint,
  p_founder_b_lamports bigint,
  p_tx_signature text,
  p_presale_supply int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sold int;
  v_existing int;
BEGIN
  PERFORM pg_advisory_xact_lock(98273491);

  IF EXISTS (SELECT 1 FROM gen2_presale_purchases WHERE tx_signature = p_tx_signature) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'duplicate_tx');
  END IF;

  SELECT COALESCE(purchased_mints, 0) + COALESCE(gifted_mints, 0) INTO v_existing
  FROM gen2_presale_balances
  WHERE wallet = p_wallet;

  IF COALESCE(v_existing, 0) + p_quantity > 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wallet_cap');
  END IF;

  SELECT COALESCE(SUM(quantity), 0)::int INTO v_sold
  FROM gen2_presale_purchases
  WHERE status = 'confirmed';

  IF v_sold + p_quantity > p_presale_supply THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sold_out');
  END IF;

  INSERT INTO gen2_presale_purchases (
    wallet,
    quantity,
    unit_price_usdc,
    sol_usd_price,
    total_lamports,
    founder_a_lamports,
    founder_b_lamports,
    tx_signature,
    status
  ) VALUES (
    p_wallet,
    p_quantity,
    p_unit_price_usdc,
    p_sol_usd_price,
    p_total_lamports,
    p_founder_a_lamports,
    p_founder_b_lamports,
    p_tx_signature,
    'confirmed'
  );

  INSERT INTO gen2_presale_balances (wallet, purchased_mints, updated_at)
  VALUES (p_wallet, p_quantity, now())
  ON CONFLICT (wallet) DO UPDATE SET
    purchased_mints = gen2_presale_balances.purchased_mints + p_quantity,
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.gift_gen2_presale_mints(
  p_actor_wallet text,
  p_recipient_wallet text,
  p_quantity int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing int;
BEGIN
  IF p_quantity <= 0 OR p_quantity > 500 THEN
    RAISE EXCEPTION 'quantity must be between 1 and 500';
  END IF;

  SELECT COALESCE(purchased_mints, 0) + COALESCE(gifted_mints, 0) INTO v_existing
  FROM gen2_presale_balances
  WHERE wallet = p_recipient_wallet;

  IF COALESCE(v_existing, 0) + p_quantity > 20 THEN
    RAISE EXCEPTION 'gen2_presale_wallet_cap_exceeded';
  END IF;

  INSERT INTO gen2_presale_gift_audit (actor_wallet, recipient_wallet, quantity)
  VALUES (p_actor_wallet, p_recipient_wallet, p_quantity);

  INSERT INTO gen2_presale_balances (wallet, gifted_mints, updated_at)
  VALUES (p_recipient_wallet, p_quantity, now())
  ON CONFLICT (wallet) DO UPDATE SET
    gifted_mints = gen2_presale_balances.gifted_mints + p_quantity,
    updated_at = now();
END;
$$;
