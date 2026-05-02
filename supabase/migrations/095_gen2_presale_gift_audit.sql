-- Audit trail + actor attribution for Gen2 presale gifts (admin-only API → service_role RPC).

CREATE TABLE IF NOT EXISTS gen2_presale_gift_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_wallet text NOT NULL,
  recipient_wallet text NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0 AND quantity <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gen2_presale_gift_audit_created_at ON gen2_presale_gift_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gen2_presale_gift_audit_recipient ON gen2_presale_gift_audit (recipient_wallet);
CREATE INDEX IF NOT EXISTS idx_gen2_presale_gift_audit_actor ON gen2_presale_gift_audit (actor_wallet);

ALTER TABLE gen2_presale_gift_audit ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE gen2_presale_gift_audit IS 'Append-only log of admin gifts; no anon/authenticated policies — reads/writes via service_role only.';

-- Replace 2-arg gift with 3-arg version: audit row + balance bump in one transaction.
DROP FUNCTION IF EXISTS public.gift_gen2_presale_mints(text, int);

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
BEGIN
  IF p_quantity <= 0 OR p_quantity > 500 THEN
    RAISE EXCEPTION 'quantity must be between 1 and 500';
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

REVOKE ALL ON FUNCTION public.gift_gen2_presale_mints(text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gift_gen2_presale_mints(text, text, int) TO service_role;
