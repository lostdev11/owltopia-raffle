-- Part 3/4: confirm_cart_batch_with_tx
-- Paste this alone. If Supabase warns about RLS / v_entry_ids, choose "Run without RLS"
-- (v_entry_ids is a function variable, not a table).

CREATE OR REPLACE FUNCTION public.confirm_cart_batch_with_tx(
  p_wallet_address TEXT,
  p_tx_sig TEXT,
  p_entry_ids UUID[]
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_entry_ids UUID[];
  v_n INT;
  v_locked INT;
  rec RECORD;
  v_raffle public.raffles%ROWTYPE;
  v_cur BIGINT;
  v_add BIGINT;
  v_wallet_cur BIGINT;
  v_upd INT;
BEGIN
  SELECT array_agg(DISTINCT u ORDER BY u), COUNT(DISTINCT u)::INT
  INTO v_entry_ids, v_n
  FROM unnest(COALESCE(p_entry_ids, '{}'::uuid[])) AS u;

  IF v_entry_ids IS NULL OR v_n < 1 THEN
    RAISE EXCEPTION 'batch_empty';
  END IF;

  IF (SELECT COUNT(*)::INT FROM public.entries WHERE id = ANY (v_entry_ids)) <> v_n THEN
    RAISE EXCEPTION 'entry_not_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.entries e
    WHERE e.id = ANY (v_entry_ids)
      AND (
        e.status IS DISTINCT FROM 'confirmed'
        OR trim(COALESCE(e.transaction_signature, '')) IS DISTINCT FROM trim(p_tx_sig)
      )
  ) THEN
    RETURN json_build_object('success', true, 'entry_ids', to_jsonb(v_entry_ids), 'idempotent', true);
  END IF;

  v_locked := 0;
  FOR rec IN
    SELECT 1 FROM public.entries e WHERE e.id = ANY (v_entry_ids) ORDER BY e.raffle_id, e.id FOR UPDATE
  LOOP
    v_locked := v_locked + 1;
  END LOOP;

  IF v_locked <> v_n THEN
    RAISE EXCEPTION 'entry_not_found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.entries e
    WHERE e.id = ANY (v_entry_ids)
      AND e.status = 'confirmed'
      AND trim(COALESCE(e.transaction_signature, '')) IS DISTINCT FROM trim(p_tx_sig)
  ) THEN
    RAISE EXCEPTION 'invalid_state: entry already confirmed with different tx';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.entries e
    WHERE e.id = ANY (v_entry_ids)
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
    WHERE e.id = ANY (v_entry_ids)
      AND COALESCE(e.referral_complimentary, false) IS TRUE
      AND COALESCE(e.amount_paid, 0)::numeric <= 0
  ) THEN
    RAISE EXCEPTION 'invalid_state: complimentary rows cannot use batch confirm';
  END IF;

  FOR rec IN
    SELECT e.raffle_id AS rid
    FROM public.entries e
    WHERE e.id = ANY (v_entry_ids)
    GROUP BY e.raffle_id
    ORDER BY e.raffle_id
  LOOP
    SELECT * INTO v_raffle FROM public.raffles WHERE id = rec.rid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'raffle_not_found';
    END IF;

    SELECT COALESCE(SUM(e3.ticket_quantity), 0)::BIGINT
    INTO v_add
    FROM public.entries e3
    WHERE e3.id = ANY (v_entry_ids) AND e3.raffle_id = rec.rid;

    IF v_raffle.max_tickets IS NOT NULL THEN
      SELECT COALESCE(SUM(e2.ticket_quantity), 0)::BIGINT
      INTO v_cur
      FROM public.entries e2
      WHERE e2.raffle_id = rec.rid AND e2.status = 'confirmed';

      IF v_cur + v_add > v_raffle.max_tickets::BIGINT THEN
        RAISE EXCEPTION 'insufficient_tickets';
      END IF;
    END IF;

    IF v_raffle.max_tickets_per_wallet IS NOT NULL THEN
      SELECT COALESCE(SUM(e2.ticket_quantity), 0)::BIGINT
      INTO v_wallet_cur
      FROM public.entries e2
      WHERE e2.raffle_id = rec.rid
        AND e2.status = 'confirmed'
        AND trim(e2.wallet_address) = trim(p_wallet_address);

      IF v_wallet_cur + v_add > v_raffle.max_tickets_per_wallet::BIGINT THEN
        RAISE EXCEPTION 'wallet_ticket_limit';
      END IF;
    END IF;
  END LOOP;

  FOR rec IN
    SELECT e.id AS eid, e.raffle_id AS rid, e.amount_paid AS apaid
    FROM public.entries e
    WHERE e.id = ANY (v_entry_ids)
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
  WHERE e.id = ANY (v_entry_ids) AND e.status = 'pending';

  GET DIAGNOSTICS v_upd = ROW_COUNT;

  IF v_upd < 1 THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.entries e
      WHERE e.id = ANY (v_entry_ids)
        AND (
          e.status IS DISTINCT FROM 'confirmed'
          OR trim(COALESCE(e.transaction_signature, '')) IS DISTINCT FROM trim(p_tx_sig)
        )
    ) THEN
      RETURN json_build_object('success', true, 'entry_ids', to_jsonb(v_entry_ids), 'idempotent', true);
    END IF;

    RAISE EXCEPTION 'invalid_state: batch confirm race or stale rows';
  END IF;

  RETURN json_build_object('success', true, 'entry_ids', to_jsonb(v_entry_ids));
END;
$fn$;

COMMENT ON FUNCTION public.confirm_cart_batch_with_tx(TEXT, TEXT, UUID[]) IS
  'Confirm every cart line in one transaction; enforces max_tickets and max_tickets_per_wallet.';
