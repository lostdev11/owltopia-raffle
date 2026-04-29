-- Owl Council: optional OWL SPL escrow for voting weight (COUNCIL_OWL_ESCROW_SECRET_KEY in app).
-- Balances are accounting; on-chain custody is the escrow wallet OWL ATA.

CREATE TABLE IF NOT EXISTS public.owl_council_escrow_balances (
  wallet_address TEXT PRIMARY KEY,
  balance_raw NUMERIC NOT NULL DEFAULT 0 CHECK (balance_raw >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.owl_council_escrow_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  delta_raw NUMERIC NOT NULL CHECK (delta_raw > 0),
  tx_signature TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT owl_council_escrow_ledger_sig_unique UNIQUE (tx_signature)
);

CREATE INDEX IF NOT EXISTS idx_owl_council_escrow_ledger_wallet
  ON public.owl_council_escrow_ledger (wallet_address);

DROP TRIGGER IF EXISTS update_owl_council_escrow_balances_updated_at ON public.owl_council_escrow_balances;
CREATE TRIGGER update_owl_council_escrow_balances_updated_at
  BEFORE UPDATE ON public.owl_council_escrow_balances
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.owl_council_escrow_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owl_council_escrow_ledger ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.owl_council_escrow_balances IS 'Per-wallet OWL credited in council escrow (off-chain ledger vs escrow ATA).';
COMMENT ON TABLE public.owl_council_escrow_ledger IS 'Deposit/withdrawal rows keyed by unique Solana tx signature.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owl_council_escrow_balances TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owl_council_escrow_ledger TO service_role;

-- Atomic deposit credit (ledger insert + balance bump).
CREATE OR REPLACE FUNCTION public.owl_council_escrow_credit_deposit(
  p_wallet text,
  p_delta_raw numeric,
  p_sig text
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_new numeric;
BEGIN
  IF p_wallet IS NULL OR btrim(p_wallet) = '' THEN
    RAISE EXCEPTION 'invalid_wallet';
  END IF;
  IF p_delta_raw IS NULL OR p_delta_raw <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;
  IF p_sig IS NULL OR btrim(p_sig) = '' THEN
    RAISE EXCEPTION 'invalid_sig';
  END IF;

  INSERT INTO public.owl_council_escrow_ledger (wallet_address, delta_raw, tx_signature, kind)
  VALUES (btrim(p_wallet), p_delta_raw, btrim(p_sig), 'deposit');

  INSERT INTO public.owl_council_escrow_balances (wallet_address, balance_raw)
  VALUES (btrim(p_wallet), p_delta_raw)
  ON CONFLICT (wallet_address) DO UPDATE
    SET balance_raw = public.owl_council_escrow_balances.balance_raw + EXCLUDED.balance_raw,
        updated_at = now()
  RETURNING balance_raw INTO v_new;

  RETURN v_new;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_tx' USING ERRCODE = '23505';
END;
$$;

-- After successful on-chain transfer escrow → user: ledger + debit balance.
CREATE OR REPLACE FUNCTION public.owl_council_escrow_finalize_withdrawal(
  p_wallet text,
  p_delta_raw numeric,
  p_sig text
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_new numeric;
BEGIN
  IF p_wallet IS NULL OR btrim(p_wallet) = '' THEN
    RAISE EXCEPTION 'invalid_wallet';
  END IF;
  IF p_delta_raw IS NULL OR p_delta_raw <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;
  IF p_sig IS NULL OR btrim(p_sig) = '' THEN
    RAISE EXCEPTION 'invalid_sig';
  END IF;

  INSERT INTO public.owl_council_escrow_ledger (wallet_address, delta_raw, tx_signature, kind)
  VALUES (btrim(p_wallet), p_delta_raw, btrim(p_sig), 'withdrawal');

  UPDATE public.owl_council_escrow_balances
  SET balance_raw = balance_raw - p_delta_raw,
      updated_at = now()
  WHERE wallet_address = btrim(p_wallet)
    AND balance_raw >= p_delta_raw
  RETURNING balance_raw INTO v_new;

  IF v_new IS NULL THEN
    DELETE FROM public.owl_council_escrow_ledger WHERE tx_signature = btrim(p_sig);
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  RETURN v_new;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_tx' USING ERRCODE = '23505';
END;
$$;

REVOKE ALL ON FUNCTION public.owl_council_escrow_credit_deposit(text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owl_council_escrow_finalize_withdrawal(text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owl_council_escrow_credit_deposit(text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.owl_council_escrow_finalize_withdrawal(text, numeric, text) TO service_role;
