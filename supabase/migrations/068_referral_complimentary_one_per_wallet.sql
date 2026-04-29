-- At most one confirmed referral complimentary (free) ticket per wallet, across all raffles.

ALTER TABLE public.entries
  ADD COLUMN IF NOT EXISTS referral_complimentary BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS complimentary_confirm_token TEXT NULL,
  ADD COLUMN IF NOT EXISTS complimentary_token_expires_at TIMESTAMPTZ NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_one_confirmed_referral_complimentary_per_wallet
  ON public.entries (wallet_address)
  WHERE referral_complimentary = true AND status = 'confirmed';

COMMENT ON INDEX public.idx_entries_one_confirmed_referral_complimentary_per_wallet IS
  'Enforces one lifetime referral free-ticket redemption per wallet (confirmed rows only).';

CREATE OR REPLACE FUNCTION public.confirm_complimentary_referral_entry(
  p_entry_id UUID,
  p_token TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_raffle public.raffles%ROWTYPE;
  v_entry public.entries%ROWTYPE;
  v_synthetic_sig TEXT;
  v_current_total BIGINT;
  v_existing_entry_id UUID;
BEGIN
  SELECT * INTO v_entry FROM public.entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entry_not_found';
  END IF;

  IF v_entry.referral_complimentary IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'invalid_state: not complimentary';
  END IF;
  IF v_entry.amount_paid IS DISTINCT FROM 0::numeric THEN
    RAISE EXCEPTION 'invalid_state: amount not zero';
  END IF;
  IF v_entry.complimentary_confirm_token IS NULL OR v_entry.complimentary_confirm_token IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;
  IF v_entry.complimentary_token_expires_at IS NULL OR v_entry.complimentary_token_expires_at < now() THEN
    RAISE EXCEPTION 'token_expired';
  END IF;

  IF v_entry.status = 'confirmed' AND v_entry.transaction_signature IS NOT NULL THEN
    RETURN json_build_object('success', true, 'entry', row_to_json(v_entry));
  END IF;
  IF v_entry.status <> 'pending' THEN
    RAISE EXCEPTION 'invalid_state: entry not pending';
  END IF;

  -- Serialize complimentary flow per wallet (pending + confirmed rows for this promo).
  PERFORM 1
  FROM public.entries e
  WHERE e.wallet_address = v_entry.wallet_address
    AND e.referral_complimentary = true
  ORDER BY e.id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.entries e
    WHERE e.wallet_address = v_entry.wallet_address
      AND e.referral_complimentary = true
      AND e.status = 'confirmed'
      AND e.id <> p_entry_id
  ) THEN
    RAISE EXCEPTION 'complimentary_quota_exceeded';
  END IF;

  SELECT * INTO v_raffle FROM public.raffles WHERE id = v_entry.raffle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'raffle_not_found';
  END IF;

  v_synthetic_sig := 'REFERRAL_FREE:' || v_entry.id::text;

  BEGIN
    INSERT INTO public.verified_transactions (tx_sig, raffle_id, entry_id, wallet_address, amount_paid)
    VALUES (v_synthetic_sig, v_entry.raffle_id, v_entry.id, v_entry.wallet_address, v_entry.amount_paid);
  EXCEPTION
    WHEN unique_violation THEN
      SELECT vt.entry_id INTO v_existing_entry_id
      FROM public.verified_transactions vt
      WHERE vt.tx_sig = v_synthetic_sig;
      IF v_existing_entry_id IS DISTINCT FROM v_entry.id THEN
        RAISE EXCEPTION 'tx_already_used';
      END IF;
      SELECT * INTO v_entry FROM public.entries WHERE id = p_entry_id;
      RETURN json_build_object('success', true, 'entry', row_to_json(v_entry));
  END;

  IF v_raffle.max_tickets IS NOT NULL THEN
    SELECT COALESCE(SUM(ticket_quantity), 0)::BIGINT INTO v_current_total
    FROM public.entries
    WHERE raffle_id = v_entry.raffle_id AND status = 'confirmed';
    IF v_current_total + v_entry.ticket_quantity > v_raffle.max_tickets THEN
      RAISE EXCEPTION 'insufficient_tickets';
    END IF;
  END IF;

  BEGIN
    UPDATE public.entries
    SET
      status = 'confirmed',
      transaction_signature = v_synthetic_sig,
      verified_at = now(),
      complimentary_confirm_token = NULL,
      complimentary_token_expires_at = NULL
    WHERE id = p_entry_id
    RETURNING * INTO v_entry;
  EXCEPTION
    WHEN unique_violation THEN
      DELETE FROM public.verified_transactions vt
      WHERE vt.tx_sig = v_synthetic_sig AND vt.entry_id = p_entry_id;
      RAISE EXCEPTION 'complimentary_quota_exceeded';
  END;

  RETURN json_build_object('success', true, 'entry', row_to_json(v_entry));
END;
$$;

COMMENT ON FUNCTION public.confirm_complimentary_referral_entry(UUID, TEXT) IS
  'Atomically confirm a referral complimentary entry; one confirmed complimentary ticket per wallet (all raffles).';
