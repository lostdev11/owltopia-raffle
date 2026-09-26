-- Stale `sending` OWL reward guards must not be silently ignored after five minutes
-- (that reopened a double-pay window). Require reconciliation before a new guard opens.

CREATE OR REPLACE FUNCTION public.staking_begin_owl_reward_transfer(
  p_wallet TEXT,
  p_amount NUMERIC,
  p_position_ids UUID[] DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet TEXT;
  v_id UUID;
BEGIN
  v_wallet := btrim(COALESCE(p_wallet, ''));
  IF v_wallet = '' THEN
    RAISE EXCEPTION 'invalid_wallet';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('owl_reward_transfer:' || v_wallet));

  IF EXISTS (
    SELECT 1 FROM public.staking_owl_reward_transfers
    WHERE wallet_address = v_wallet AND status = 'sent'
  ) THEN
    RAISE EXCEPTION 'owl_reward_transfer_unreconciled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staking_owl_reward_transfers
    WHERE wallet_address = v_wallet
      AND status = 'sending'
      AND created_at > now() - INTERVAL '5 minutes'
  ) THEN
    RAISE EXCEPTION 'owl_reward_transfer_in_flight';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staking_owl_reward_transfers
    WHERE wallet_address = v_wallet
      AND status = 'sending'
      AND created_at <= now() - INTERVAL '5 minutes'
  ) THEN
    RAISE EXCEPTION 'owl_reward_transfer_stale_sending';
  END IF;

  INSERT INTO public.staking_owl_reward_transfers (wallet_address, position_ids, amount_ui, status)
  VALUES (v_wallet, COALESCE(p_position_ids, '{}'), p_amount, 'sending')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.staking_begin_owl_reward_transfer IS
  'Opens an OWL reward transfer guard row (status=sending) under a per-wallet advisory lock; raises owl_reward_transfer_unreconciled / owl_reward_transfer_in_flight / owl_reward_transfer_stale_sending when a prior payout is orphaned, in-flight, or needs reconciliation.';
