-- Allow one on-chain OWL payout (single tx signature) to back multiple nest claim ledger rows.

DROP INDEX IF EXISTS idx_staking_reward_events_tx_sig_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_staking_reward_events_tx_sig_position_unique
  ON public.staking_reward_events (transaction_signature, position_id)
  WHERE transaction_signature IS NOT NULL AND btrim(transaction_signature) <> '';

CREATE OR REPLACE FUNCTION public.staking_record_reward_claim(
  p_position_id UUID,
  p_wallet TEXT,
  p_amount NUMERIC,
  p_new_claimed_total NUMERIC,
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
  v_pos public.staking_positions%ROWTYPE;
  v_sig TEXT;
  v_path TEXT;
  v_existing public.staking_reward_events%ROWTYPE;
BEGIN
  IF p_position_id IS NULL THEN
    RAISE EXCEPTION 'invalid_position';
  END IF;
  IF p_wallet IS NULL OR btrim(p_wallet) = '' THEN
    RAISE EXCEPTION 'invalid_wallet';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;
  IF p_new_claimed_total IS NULL OR p_new_claimed_total < 0 THEN
    RAISE EXCEPTION 'invalid_claimed_total';
  END IF;

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

  IF v_sig IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.staking_reward_events
    WHERE transaction_signature = v_sig
      AND position_id = p_position_id
    LIMIT 1;

    IF FOUND THEN
      IF v_existing.wallet_address IS DISTINCT FROM btrim(p_wallet)
         OR v_existing.amount IS DISTINCT FROM p_amount THEN
        RAISE EXCEPTION 'duplicate_tx' USING ERRCODE = '23505';
      END IF;

      SELECT * INTO v_pos
      FROM public.staking_positions
      WHERE id = p_position_id AND wallet_address = btrim(p_wallet);

      IF NOT FOUND THEN
        RAISE EXCEPTION 'position_not_found';
      END IF;

      RETURN jsonb_build_object(
        'idempotent', true,
        'claimed_rewards', v_pos.claimed_rewards
      );
    END IF;
  END IF;

  UPDATE public.staking_positions
  SET
    claimed_rewards = p_new_claimed_total,
    last_claim_signature = COALESCE(v_sig, last_claim_signature),
    updated_at = now()
  WHERE id = p_position_id
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
    p_position_id,
    btrim(p_wallet),
    'claim',
    p_amount,
    NULLIF(btrim(COALESCE(p_note, '')), ''),
    v_sig,
    v_path
  );

  RETURN jsonb_build_object(
    'idempotent', false,
    'claimed_rewards', v_pos.claimed_rewards
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_tx' USING ERRCODE = '23505';
END;
$$;
