-- Optional per-wallet ticket cap on raffles (alongside global max_tickets).

-- NULL = no per-person limit. Enforced in confirm RPCs under raffle row lock.

-- If applying via Supabase SQL Editor, prefer scripts/sql/apply-224-max-tickets-per-wallet/ parts.

-- Part 1/4: column + constraints (run this first)
-- Safe to re-run.

ALTER TABLE public.raffles
  ADD COLUMN IF NOT EXISTS max_tickets_per_wallet INTEGER;

ALTER TABLE public.raffles
  DROP CONSTRAINT IF EXISTS raffles_max_tickets_per_wallet_check;

ALTER TABLE public.raffles
  ADD CONSTRAINT raffles_max_tickets_per_wallet_check
  CHECK (max_tickets_per_wallet IS NULL OR max_tickets_per_wallet > 0);

ALTER TABLE public.raffles
  DROP CONSTRAINT IF EXISTS raffles_max_tickets_per_wallet_lte_max_check;

ALTER TABLE public.raffles
  ADD CONSTRAINT raffles_max_tickets_per_wallet_lte_max_check
  CHECK (
    max_tickets IS NULL
    OR max_tickets_per_wallet IS NULL
    OR max_tickets_per_wallet <= max_tickets
  );

CREATE INDEX IF NOT EXISTS idx_raffles_max_tickets_per_wallet
  ON public.raffles (max_tickets_per_wallet)
  WHERE max_tickets_per_wallet IS NOT NULL;

COMMENT ON COLUMN public.raffles.max_tickets_per_wallet IS
  'Optional max confirmed tickets any single wallet may hold for this raffle. NULL = unlimited per wallet.';


-- Part 2/4: confirm_entry_with_tx
-- Paste this alone in the SQL editor (do not combine with other parts).

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
AS $fn$
DECLARE
  v_raffle public.raffles%ROWTYPE;
  v_entry public.entries%ROWTYPE;
  v_current_total BIGINT;
  v_wallet_total BIGINT;
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

  IF v_raffle.max_tickets_per_wallet IS NOT NULL THEN
    SELECT COALESCE(SUM(ticket_quantity), 0)::BIGINT INTO v_wallet_total
    FROM public.entries
    WHERE raffle_id = p_raffle_id
      AND status = 'confirmed'
      AND wallet_address = p_wallet_address;
    IF v_wallet_total + v_entry.ticket_quantity > v_raffle.max_tickets_per_wallet THEN
      RAISE EXCEPTION 'wallet_ticket_limit';
    END IF;
  END IF;

  UPDATE public.entries
  SET status = 'confirmed', transaction_signature = p_tx_sig, verified_at = now()
  WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  RETURN json_build_object('success', true, 'entry', row_to_json(v_entry));
END;
$fn$;

COMMENT ON FUNCTION public.confirm_entry_with_tx(UUID, UUID, TEXT, TEXT, NUMERIC, INT) IS
  'Atomic confirm entry with tx; enforces max_tickets and max_tickets_per_wallet. Idempotent per (entry, sig).';


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


-- Part 4/4: confirm_complimentary_referral_entry
-- Paste this alone.

CREATE OR REPLACE FUNCTION public.confirm_complimentary_referral_entry(
  p_entry_id UUID,
  p_token TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_raffle public.raffles%ROWTYPE;
  v_entry public.entries%ROWTYPE;
  v_synthetic_sig TEXT;
  v_current_total BIGINT;
  v_wallet_total BIGINT;
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

  IF v_raffle.max_tickets_per_wallet IS NOT NULL THEN
    SELECT COALESCE(SUM(ticket_quantity), 0)::BIGINT INTO v_wallet_total
    FROM public.entries
    WHERE raffle_id = v_entry.raffle_id
      AND status = 'confirmed'
      AND wallet_address = v_entry.wallet_address;
    IF v_wallet_total + v_entry.ticket_quantity > v_raffle.max_tickets_per_wallet THEN
      RAISE EXCEPTION 'wallet_ticket_limit';
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
$fn$;

COMMENT ON FUNCTION public.confirm_complimentary_referral_entry(UUID, TEXT) IS
  'Confirm referral complimentary entry; enforces max_tickets and max_tickets_per_wallet; one free ticket per wallet lifetime.';
