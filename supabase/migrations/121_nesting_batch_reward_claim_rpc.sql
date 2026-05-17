-- Atomic multi-nest reward claim ledger writes (Claim all).
-- One transaction + per-wallet advisory lock prevents partial updates and concurrent batch claims.

CREATE OR REPLACE FUNCTION public.staking_record_batch_reward_claim(
  p_wallet TEXT,
  p_items JSONB,
  p_note TEXT DEFAULT NULL,
  p_transaction_signature TEXT DEFAULT NULL,
  p_execution_path TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_position_id UUID;
  v_amount NUMERIC;
  v_new_claimed_total NUMERIC;
  v_sig TEXT;
  v_path TEXT;
  v_pos public.staking_positions%ROWTYPE;
  v_existing public.staking_reward_events%ROWTYPE;
  v_recorded INT := 0;
  v_idempotent INT := 0;
BEGIN
  IF p_wallet IS NULL OR btrim(p_wallet) = '' THEN
    RAISE EXCEPTION 'invalid_wallet';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'invalid_items';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('nesting_batch_claim:' || btrim(p_wallet)));

  v_sig := NULLIF(btrim(COALESCE(p_transaction_signature, '')), '');
  v_path := NULLIF(btrim(COALESCE(p_execution_path, '')), '');

  IF v_path IS NOT NULL AND v_path NOT IN ('onchain_transfer', 'database_only') THEN
    RAISE EXCEPTION 'invalid_execution_path';
  END IF;

  IF v_sig IS NOT NULL AND v_path IS NULL THEN
    v_path := 'onchain_transfer';
  ELSIF v_sig IS NULL AND v_path IS NULL AND NULLIF(btrim(COALESCE(p_note, '')), '') = 'db_only_owl_claim' THEN
    v_path := 'database_only';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_position_id := NULLIF(btrim(COALESCE(v_item->>'position_id', '')), '')::UUID;
    v_amount := (v_item->>'amount')::NUMERIC;
    v_new_claimed_total := (v_item->>'new_claimed_total')::NUMERIC;

    IF v_position_id IS NULL THEN
      RAISE EXCEPTION 'invalid_position';
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'invalid_amount';
    END IF;
    IF v_new_claimed_total IS NULL OR v_new_claimed_total < 0 THEN
      RAISE EXCEPTION 'invalid_claimed_total';
    END IF;

    IF v_sig IS NOT NULL THEN
      SELECT * INTO v_existing
      FROM public.staking_reward_events
      WHERE transaction_signature = v_sig
        AND position_id = v_position_id
      LIMIT 1;

      IF FOUND THEN
        IF v_existing.wallet_address IS DISTINCT FROM btrim(p_wallet)
           OR v_existing.amount IS DISTINCT FROM v_amount THEN
          RAISE EXCEPTION 'duplicate_tx' USING ERRCODE = '23505';
        END IF;
        v_idempotent := v_idempotent + 1;
        CONTINUE;
      END IF;
    END IF;

    UPDATE public.staking_positions
    SET
      claimed_rewards = v_new_claimed_total,
      last_claim_signature = COALESCE(v_sig, last_claim_signature),
      updated_at = now()
    WHERE id = v_position_id
      AND wallet_address = btrim(p_wallet)
    RETURNING * INTO v_pos;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'position_not_found';
    END IF;

    INSERT INTO public.staking_reward_events (
      position_id,
      wallet_address,
      event_type,
      amount,
      note,
      transaction_signature,
      execution_path
    )
    VALUES (
      v_position_id,
      btrim(p_wallet),
      'claim',
      v_amount,
      NULLIF(btrim(COALESCE(p_note, '')), ''),
      v_sig,
      v_path
    );

    v_recorded := v_recorded + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'recorded_count', v_recorded,
    'idempotent_count', v_idempotent,
    'item_count', jsonb_array_length(p_items)
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_tx' USING ERRCODE = '23505';
END;
$$;

COMMENT ON FUNCTION public.staking_record_batch_reward_claim IS
  'Atomically records Claim-all ledger rows for every nest in one transaction (same tx signature allowed per position).';

GRANT EXECUTE ON FUNCTION public.staking_record_batch_reward_claim(TEXT, JSONB, TEXT, TEXT, TEXT) TO service_role;
