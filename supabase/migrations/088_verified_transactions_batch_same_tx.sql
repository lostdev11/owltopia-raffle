-- ============================================================================
-- Migration 088: Allow multiple entries to share one on-chain transaction (cart batch)
-- ============================================================================
-- Before: verified_transactions.pk = tx_sig (one row globally per signature).
-- After: pk = (tx_sig, entry_id) so several entries can legally reference the same
-- payment proof when verified together via /api/entries/verify-batch.
-- Replay protection stays: one row per (tx_sig, entry_id); same pair is idempotent.
-- -----------------------------------------------------------------------------
-- Postgres 15+: DROP CONSTRAINT verified_transactions_pkey; ADD PRIMARY KEY.

ALTER TABLE public.verified_transactions
  DROP CONSTRAINT IF EXISTS verified_transactions_pkey;

ALTER TABLE public.verified_transactions
  ADD CONSTRAINT verified_transactions_pkey PRIMARY KEY (tx_sig, entry_id);

CREATE INDEX IF NOT EXISTS idx_verified_transactions_tx_sig_only
  ON public.verified_transactions (tx_sig);

COMMENT ON TABLE public.verified_transactions IS 'Idempotency: one row per (tx_sig, entry_id). Supports batch checkout with shared payment signatures.';

-- Update unique_violation handler: duplicate (tx_sig, entry_id) is idempotent replay.
CREATE OR REPLACE FUNCTION public.confirm_entry_with_tx(
  p_entry_id UUID,
  p_raffle_id UUID,
  p_wallet_address TEXT,
  p_tx_sig TEXT,
  p_amount_paid NUMERIC,
  p_ticket_quantity INT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_raffle public.raffles%ROWTYPE;
  v_entry public.entries%ROWTYPE;
  v_current_total BIGINT;
BEGIN
  SELECT * INTO v_raffle FROM public.raffles WHERE id = p_raffle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'raffle_not_found';
  END IF;

  SELECT * INTO v_entry FROM public.entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entry_not_found';
  END IF;

  IF v_entry.raffle_id IS DISTINCT FROM p_raffle_id THEN
    RAISE EXCEPTION 'invalid_state: entry does not belong to raffle';
  END IF;
  IF v_entry.wallet_address IS DISTINCT FROM p_wallet_address THEN
    RAISE EXCEPTION 'invalid_state: wallet mismatch';
  END IF;

  IF v_entry.status = 'confirmed' AND v_entry.transaction_signature = p_tx_sig THEN
    RETURN json_build_object('success', true, 'entry', row_to_json(v_entry));
  END IF;
  IF v_entry.status != 'pending' THEN
    RAISE EXCEPTION 'invalid_state: entry not pending';
  END IF;

  BEGIN
    INSERT INTO public.verified_transactions (tx_sig, raffle_id, entry_id, wallet_address, amount_paid)
    VALUES (p_tx_sig, p_raffle_id, p_entry_id, p_wallet_address, v_entry.amount_paid);
  EXCEPTION
    WHEN unique_violation THEN
      -- Composite PK (tx_sig, entry_id): idempotent retries for same entry + signature only.
      SELECT * INTO v_entry FROM public.entries WHERE id = p_entry_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'entry_not_found';
      END IF;
      RETURN json_build_object('success', true, 'entry', row_to_json(v_entry));
  END;

  IF v_raffle.max_tickets IS NOT NULL THEN
    SELECT COALESCE(SUM(ticket_quantity), 0)::BIGINT INTO v_current_total
    FROM public.entries
    WHERE raffle_id = p_raffle_id AND status = 'confirmed';
    IF v_current_total + v_entry.ticket_quantity > v_raffle.max_tickets THEN
      RAISE EXCEPTION 'insufficient_tickets';
    END IF;
  END IF;

  UPDATE public.entries
  SET status = 'confirmed', transaction_signature = p_tx_sig, verified_at = now()
  WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  RETURN json_build_object('success', true, 'entry', row_to_json(v_entry));
END;
$$;

COMMENT ON FUNCTION public.confirm_entry_with_tx(UUID, UUID, TEXT, TEXT, NUMERIC, INT) IS
  'Atomic confirm entry with tx; supports shared tx_sig across distinct entry_id (cart batch checkout). Idempotent per (entry, sig).';
