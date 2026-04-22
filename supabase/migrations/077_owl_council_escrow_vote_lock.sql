-- Lock OWL council escrow withdrawals against voting_power already used on proposals
-- whose voting window is still open (status active, now within [start_time, end_time]).

ALTER TABLE public.owl_votes
  ADD COLUMN IF NOT EXISTS council_vote_used_escrow BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.owl_votes.council_vote_used_escrow IS
  'When true, voting_power was OWL credited in council escrow; that weight stays non-withdrawable until the proposal voting window ends.';

-- Sum of TRUNC(voting_power * 10^decimals) for escrow-weighted votes on proposals where voting is still open.
CREATE OR REPLACE FUNCTION public.owl_council_escrow_vote_locked_raw(
  p_wallet text,
  p_decimals int
) RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    SUM(TRUNC(v.voting_power * power(10::numeric, p_decimals))),
    0::numeric
  )
  FROM public.owl_votes v
  INNER JOIN public.owl_proposals p ON p.id = v.proposal_id
  WHERE btrim(v.wallet_address) = btrim(p_wallet)
    AND v.council_vote_used_escrow = TRUE
    AND p.status = 'active'
    AND now() >= p.start_time
    AND now() <= p.end_time;
$$;

REVOKE ALL ON FUNCTION public.owl_council_escrow_vote_locked_raw(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owl_council_escrow_vote_locked_raw(text, int) TO service_role;

DROP FUNCTION IF EXISTS public.owl_council_escrow_finalize_withdrawal(text, numeric, text);

CREATE OR REPLACE FUNCTION public.owl_council_escrow_finalize_withdrawal(
  p_wallet text,
  p_delta_raw numeric,
  p_sig text,
  p_decimals int
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new numeric;
  v_balance numeric;
  v_locked numeric;
  v_available numeric;
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
  IF p_decimals IS NULL OR p_decimals < 0 OR p_decimals > 9 THEN
    RAISE EXCEPTION 'invalid_decimals';
  END IF;

  SELECT b.balance_raw INTO v_balance
  FROM public.owl_council_escrow_balances b
  WHERE b.wallet_address = btrim(p_wallet);

  IF v_balance IS NULL THEN
    v_balance := 0;
  END IF;

  v_locked := public.owl_council_escrow_vote_locked_raw(p_wallet, p_decimals);
  v_available := GREATEST(v_balance - v_locked, 0::numeric);

  IF p_delta_raw > v_available THEN
    RAISE EXCEPTION 'votes_locked_or_insufficient';
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

REVOKE ALL ON FUNCTION public.owl_council_escrow_finalize_withdrawal(text, numeric, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owl_council_escrow_finalize_withdrawal(text, numeric, text, int) TO service_role;
