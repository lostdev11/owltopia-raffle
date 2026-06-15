-- Owltopia Gen2 presale: on-chain payment tracking + mint credits (no SPL token yet).

CREATE TABLE IF NOT EXISTS gen2_presale_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet text NOT NULL,
  quantity int NOT NULL,
  unit_price_usdc numeric NOT NULL DEFAULT 20,
  sol_usd_price numeric NOT NULL,
  total_lamports bigint NOT NULL,
  founder_a_lamports bigint NOT NULL,
  founder_b_lamports bigint NOT NULL,
  tx_signature text NOT NULL,
  status text NOT NULL DEFAULT 'confirmed',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gen2_presale_purchases_quantity_pos CHECK (quantity > 0),
  CONSTRAINT gen2_presale_purchases_status_check CHECK (status IN ('pending', 'confirmed', 'failed', 'refunded')),
  CONSTRAINT gen2_presale_purchases_tx_signature_unique UNIQUE (tx_signature)
);

CREATE INDEX IF NOT EXISTS idx_gen2_presale_purchases_wallet ON gen2_presale_purchases (wallet);
CREATE INDEX IF NOT EXISTS idx_gen2_presale_purchases_tx_signature ON gen2_presale_purchases (tx_signature);
CREATE INDEX IF NOT EXISTS idx_gen2_presale_purchases_created_at ON gen2_presale_purchases (created_at DESC);

CREATE TABLE IF NOT EXISTS gen2_presale_balances (
  wallet text PRIMARY KEY,
  purchased_mints int NOT NULL DEFAULT 0,
  gifted_mints int NOT NULL DEFAULT 0,
  used_mints int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gen2_presale_balances_purchased_nonneg CHECK (purchased_mints >= 0),
  CONSTRAINT gen2_presale_balances_gifted_nonneg CHECK (gifted_mints >= 0),
  CONSTRAINT gen2_presale_balances_used_nonneg CHECK (used_mints >= 0),
  CONSTRAINT gen2_presale_balances_used_cap CHECK (used_mints <= purchased_mints + gifted_mints)
);

ALTER TABLE gen2_presale_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE gen2_presale_balances ENABLE ROW LEVEL SECURITY;

-- Writes via service role only; anon/authenticated have no policies.

DROP VIEW IF EXISTS gen2_presale_available_balances;

CREATE VIEW gen2_presale_available_balances AS
SELECT
  wallet,
  purchased_mints,
  gifted_mints,
  used_mints,
  (purchased_mints + gifted_mints - used_mints) AS available_mints
FROM gen2_presale_balances;

-- Upsert + increment purchased_mints (admin/backfill; confirm flow uses atomic RPC below)
CREATE OR REPLACE FUNCTION public.increment_gen2_presale_purchase(p_wallet text, p_quantity int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive';
  END IF;
  INSERT INTO gen2_presale_balances (wallet, purchased_mints, updated_at)
  VALUES (p_wallet, p_quantity, now())
  ON CONFLICT (wallet) DO UPDATE SET
    purchased_mints = gen2_presale_balances.purchased_mints + p_quantity,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.gift_gen2_presale_mints(p_wallet text, p_quantity int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive';
  END IF;
  INSERT INTO gen2_presale_balances (wallet, gifted_mints, updated_at)
  VALUES (p_wallet, p_quantity, now())
  ON CONFLICT (wallet) DO UPDATE SET
    gifted_mints = gen2_presale_balances.gifted_mints + p_quantity,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.use_gen2_presale_mints(p_wallet text, p_quantity int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avail int;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive';
  END IF;

  SELECT (purchased_mints + gifted_mints - used_mints) INTO v_avail
  FROM gen2_presale_balances
  WHERE wallet = p_wallet;

  IF v_avail IS NULL OR v_avail < p_quantity THEN
    RAISE EXCEPTION 'insufficient available mints';
  END IF;

  UPDATE gen2_presale_balances
  SET used_mints = used_mints + p_quantity,
      updated_at = now()
  WHERE wallet = p_wallet;
END;
$$;

-- Atomic confirm: advisory lock, duplicate tx check, oversell guard, insert purchase + balance bump
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
BEGIN
  PERFORM pg_advisory_xact_lock(98273491);

  IF EXISTS (SELECT 1 FROM gen2_presale_purchases WHERE tx_signature = p_tx_signature) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'duplicate_tx');
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

REVOKE ALL ON FUNCTION public.increment_gen2_presale_purchase(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gift_gen2_presale_mints(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.use_gen2_presale_mints(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_gen2_presale_purchase(text, int, numeric, numeric, bigint, bigint, bigint, text, int) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.increment_gen2_presale_purchase(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.gift_gen2_presale_mints(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.use_gen2_presale_mints(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_gen2_presale_purchase(text, int, numeric, numeric, bigint, bigint, bigint, text, int) TO service_role;
