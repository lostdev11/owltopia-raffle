-- ============================================================================
-- Migration 090: Atomically confirm all cart batch entries in one transaction
-- ============================================================================
-- verify-batch used multiple confirm_entry_with_tx calls. After the first RPC
-- commits, a failure on a later row (insufficient_tickets, race, etc.) left a
-- paid merged tx with only some entries confirmed — bad UX and "tickets gone".
-- This function locks every batch row in stable order + affected raffles, checks
-- max_tickets for the whole batch, inserts all verified_transactions rows, then
-- updates all entries. All-or-nothing within one DB transaction.

CREATE OR REPLACE FUNCTION public.confirm_cart_batch_with_tx(
  p_wallet_address TEXT,
  p_tx_sig TEXT,
  p_entry_ids UUID[]
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[];
  v_n INT;
  v_locked INT;
  rec RECORD;
  v_raffle public.raffles%ROWTYPE;
  v_cur BIGINT;
  v_add BIGINT;
  v_upd INT;
BEGIN
  SELECT array_agg(DISTINCT u ORDER BY u), COUNT(DISTINCT u)::INT
  INTO v_ids, v_n
  FROM unnest(COALESCE(p_entry_ids, '{}'::uuid[])) AS u;

  IF v_ids IS NULL OR v_n < 1 THEN
    RAISE EXCEPTION 'batch_empty';
  END IF;

  IF (SELECT COUNT(*)::INT FROM public.entries WHERE id = ANY (v_ids)) <> v_n THEN
    RAISE EXCEPTION 'entry_not_found';
  END IF;

  -- Fast idempotent: already fully confirmed with this tx (avoid row locks when possible)
  IF NOT EXISTS (
    SELECT 1
    FROM public.entries e
    WHERE e.id = ANY (v_ids)
      AND (
        e.status IS DISTINCT FROM 'confirmed'
        OR trim(COALESCE(e.transaction_signature, '')) IS DISTINCT FROM trim(p_tx_sig)
      )
  ) THEN
    RETURN json_build_object('success', true, 'entry_ids', to_jsonb(v_ids), 'idempotent', true);
  END IF;

  -- Hold locks on affected entries until function END
  v_locked := 0;
  FOR rec IN
    SELECT 1 FROM public.entries e WHERE e.id = ANY (v_ids) ORDER BY e.raffle_id, e.id FOR UPDATE
  LOOP
    v_locked := v_locked + 1;
  END LOOP;

  IF v_locked <> v_n THEN
    RAISE EXCEPTION 'entry_not_found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.entries e
    WHERE e.id = ANY (v_ids)
      AND e.status = 'confirmed'
      AND trim(COALESCE(e.transaction_signature, '')) IS DISTINCT FROM trim(p_tx_sig)
  ) THEN
    RAISE EXCEPTION 'invalid_state: entry already confirmed with different tx';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.entries e
    WHERE e.id = ANY (v_ids)
      AND (
        trim(e.wallet_address) IS DISTINCT FROM trim(p_wallet_address)
        OR e.status IS DISTINCT FROM 'pending'
      )
  ) THEN
    RAISE EXCEPTION 'invalid_state: batch entries must be pending for this wallet';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.entries e
    WHERE e.id = ANY (v_ids)
      AND COALESCE(e.referral_complimentary, false) IS TRUE
      AND COALESCE(e.amount_paid, 0)::numeric <= 0
  ) THEN
    RAISE EXCEPTION 'invalid_state: complimentary rows cannot use batch confirm';
  END IF;

  FOR rec IN
    SELECT e.raffle_id AS rid
    FROM public.entries e
    WHERE e.id = ANY (v_ids)
    GROUP BY e.raffle_id
    ORDER BY e.raffle_id
  LOOP
    SELECT * INTO v_raffle FROM public.raffles WHERE id = rec.rid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'raffle_not_found';
    END IF;

    IF v_raffle.max_tickets IS NULL THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(e2.ticket_quantity), 0)::BIGINT
    INTO v_cur
    FROM public.entries e2
    WHERE e2.raffle_id = rec.rid AND e2.status = 'confirmed';

    SELECT COALESCE(SUM(e3.ticket_quantity), 0)::BIGINT
    INTO v_add
    FROM public.entries e3
    WHERE e3.id = ANY (v_ids) AND e3.raffle_id = rec.rid;

    IF v_cur + v_add > v_raffle.max_tickets::BIGINT THEN
      RAISE EXCEPTION 'insufficient_tickets';
    END IF;
  END LOOP;

  FOR rec IN
    SELECT e.id AS eid, e.raffle_id AS rid, e.amount_paid AS apaid
    FROM public.entries e
    WHERE e.id = ANY (v_ids)
    ORDER BY e.raffle_id, e.id
  LOOP
    BEGIN
      INSERT INTO public.verified_transactions (tx_sig, raffle_id, entry_id, wallet_address, amount_paid)
      VALUES (p_tx_sig, rec.rid, rec.eid, trim(p_wallet_address), rec.apaid);
    EXCEPTION
      WHEN unique_violation THEN
        IF NOT EXISTS (
          SELECT 1
          FROM public.verified_transactions vt
          WHERE vt.tx_sig = p_tx_sig AND vt.entry_id = rec.eid
        ) THEN
          RAISE;
        END IF;
    END;
  END LOOP;

  UPDATE public.entries e
  SET
    status = 'confirmed',
    transaction_signature = p_tx_sig,
    verified_at = now()
  WHERE e.id = ANY (v_ids) AND e.status = 'pending';

  GET DIAGNOSTICS v_upd = ROW_COUNT;

  IF v_upd < 1 THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.entries e
      WHERE e.id = ANY (v_ids)
        AND (
          e.status IS DISTINCT FROM 'confirmed'
          OR trim(COALESCE(e.transaction_signature, '')) IS DISTINCT FROM trim(p_tx_sig)
        )
    ) THEN
      RETURN json_build_object('success', true, 'entry_ids', to_jsonb(v_ids), 'idempotent', true);
    END IF;

    RAISE EXCEPTION 'invalid_state: batch confirm race or stale rows';
  END IF;

  RETURN json_build_object('success', true, 'entry_ids', to_jsonb(v_ids));
END;
$$;

COMMENT ON FUNCTION public.confirm_cart_batch_with_tx(TEXT, TEXT, UUID[]) IS
  'Confirm every cart line in one transaction after shared payment tx is verified on-chain.';
