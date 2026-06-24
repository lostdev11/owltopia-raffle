-- Fix: production drifted and still had the single-column unique index
-- `idx_staking_reward_events_tx_sig_unique` from migration 118, instead of the
-- per-(signature, position) index from migration 120. Because "Claim all" sends
-- ONE on-chain OWL transfer and then writes one ledger row per nest sharing that
-- same tx signature, the old index rejected every row after the first with a
-- unique_violation. The batch RPC transaction rolled back, so OWL was sent
-- on-chain but NOTHING was recorded — users saw "didn't claim" and retried,
-- re-sending OWL each time (treasury drain).
--
-- A migration version collision (repo 121 vs production 121 = partner_pro) meant
-- migration 120's index swap never actually applied on the remote DB. This
-- migration is fully idempotent and re-asserts the correct end state regardless
-- of prior history.

-- 1) Correct the unique index: allow one tx signature to back many nest rows.
DROP INDEX IF EXISTS idx_staking_reward_events_tx_sig_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_staking_reward_events_tx_sig_position_unique
  ON public.staking_reward_events (transaction_signature, position_id)
  WHERE transaction_signature IS NOT NULL AND btrim(transaction_signature) <> '';

-- 2) Re-assert the batch claim RPC (CREATE OR REPLACE) so the function and its
--    grant are guaranteed present even on environments where the original
--    121_nesting_batch_reward_claim_rpc migration was skipped by the collision.
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
