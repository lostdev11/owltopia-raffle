-- ============================================================================
-- Migration 030: confirm_entry_with_tx use entry row values (defense in depth)
-- ============================================================================
-- Use v_entry.amount_paid and v_entry.ticket_quantity from the locked entry row
-- for verified_transactions insert and max_tickets check. Prevents any caller from
-- passing manipulated values; DB is single source of truth.

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
  v_existing_entry_id UUID;
BEGIN
  -- Lock raffle row
  SELECT * INTO v_raffle FROM public.raffles WHERE id = p_raffle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'raffle_not_found';
  END IF;

  -- Lock entry row
  SELECT * INTO v_entry FROM public.entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entry_not_found';
  END IF;

  -- Validate: entry belongs to raffle, wallet matches
  IF v_entry.raffle_id IS DISTINCT FROM p_raffle_id THEN
    RAISE EXCEPTION 'invalid_state: entry does not belong to raffle';
  END IF;
  IF v_entry.wallet_address IS DISTINCT FROM p_wallet_address THEN
    RAISE EXCEPTION 'invalid_state: wallet mismatch';
  END IF;

  -- Entry must be pending, or idempotent: already confirmed with same tx
  IF v_entry.status = 'confirmed' AND v_entry.transaction_signature = p_tx_sig THEN
    RETURN json_build_object('success', true, 'entry', row_to_json(v_entry));
  END IF;
  IF v_entry.status != 'pending' THEN
    RAISE EXCEPTION 'invalid_state: entry not pending';
  END IF;

  -- Insert using entry row values only (defense in depth: ignore caller-supplied amount/quantity)
  BEGIN
    INSERT INTO public.verified_transactions (tx_sig, raffle_id, entry_id, wallet_address, amount_paid)
    VALUES (p_tx_sig, p_raffle_id, p_entry_id, p_wallet_address, v_entry.amount_paid);
  EXCEPTION
    WHEN unique_violation THEN
      SELECT vt.entry_id INTO v_existing_entry_id
      FROM public.verified_transactions vt
      WHERE vt.tx_sig = p_tx_sig;
      IF v_existing_entry_id IS DISTINCT FROM p_entry_id THEN
        RAISE EXCEPTION 'tx_already_used';
      END IF;
      -- Same entry: idempotent; entry may already be confirmed
      SELECT * INTO v_entry FROM public.entries WHERE id = p_entry_id;
      RETURN json_build_object('success', true, 'entry', row_to_json(v_entry));
  END;

  -- Enforce max_tickets using entry row value only
  IF v_raffle.max_tickets IS NOT NULL THEN
    SELECT COALESCE(SUM(ticket_quantity), 0)::BIGINT INTO v_current_total
    FROM public.entries
    WHERE raffle_id = p_raffle_id AND status = 'confirmed';
    IF v_current_total + v_entry.ticket_quantity > v_raffle.max_tickets THEN
      RAISE EXCEPTION 'insufficient_tickets';
    END IF;
  END IF;

  -- Update entry: confirmed, signature, verified_at
  UPDATE public.entries
  SET status = 'confirmed', transaction_signature = p_tx_sig, verified_at = now()
  WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  RETURN json_build_object('success', true, 'entry', row_to_json(v_entry));
END;
$$;

COMMENT ON FUNCTION public.confirm_entry_with_tx(UUID, UUID, TEXT, TEXT, NUMERIC, INT) IS
  'Atomic confirm entry with tx. Uses locked entry row for amount_paid and ticket_quantity (defense in depth).';
