-- Treasury-protection guard for OWL reward claims.
--
-- Claim (single + Claim all) sends ONE on-chain OWL transfer, then records the
-- ledger. If recording fails AFTER the transfer (index drift, timeout, crash),
-- the payout is "orphaned": OWL left the treasury but the UI still shows it
-- claimable, so retries re-send OWL (treasury drain).
--
-- This durable log records intent BEFORE the transfer and blocks new claims for a
-- wallet while a prior transfer is in-flight or sent-but-unrecorded, so OWL can
-- never be silently re-sent. Admin reconciliation resolves orphaned rows.

CREATE TABLE IF NOT EXISTS public.staking_owl_reward_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  position_ids UUID[] NOT NULL DEFAULT '{}',
  amount_ui NUMERIC NOT NULL,
  tx_signature TEXT,
  status TEXT NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending', 'sent', 'recorded', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.staking_owl_reward_transfers IS
  'Idempotency/intent log for OWL reward payouts. status=sent means OWL was sent on-chain but the ledger was not yet recorded (orphaned) — blocks further claims for the wallet until reconciled.';

CREATE INDEX IF NOT EXISTS idx_staking_owl_reward_transfers_wallet_status
  ON public.staking_owl_reward_transfers (wallet_address, status);

ALTER TABLE public.staking_owl_reward_transfers ENABLE ROW LEVEL SECURITY;
-- API + service role only (writes go through getSupabaseAdmin()); no anon/authenticated policy.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staking_owl_reward_transfers TO service_role;

-- Atomically open a transfer guard. Raises if a blocking row exists.
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

  -- Orphaned on-chain payout not yet recorded — never auto re-send.
  IF EXISTS (
    SELECT 1 FROM public.staking_owl_reward_transfers
    WHERE wallet_address = v_wallet AND status = 'sent'
  ) THEN
    RAISE EXCEPTION 'owl_reward_transfer_unreconciled';
  END IF;

  -- Another claim is actively mid-flight for this wallet.
  IF EXISTS (
    SELECT 1 FROM public.staking_owl_reward_transfers
    WHERE wallet_address = v_wallet
      AND status = 'sending'
      AND created_at > now() - INTERVAL '5 minutes'
  ) THEN
    RAISE EXCEPTION 'owl_reward_transfer_in_flight';
  END IF;

  INSERT INTO public.staking_owl_reward_transfers (wallet_address, position_ids, amount_ui, status)
  VALUES (v_wallet, COALESCE(p_position_ids, '{}'), p_amount, 'sending')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.staking_begin_owl_reward_transfer IS
  'Opens an OWL reward transfer guard row (status=sending) under a per-wallet advisory lock; raises owl_reward_transfer_unreconciled / owl_reward_transfer_in_flight when a prior payout is orphaned or in-flight.';

GRANT EXECUTE ON FUNCTION public.staking_begin_owl_reward_transfer(TEXT, NUMERIC, UUID[]) TO service_role;
