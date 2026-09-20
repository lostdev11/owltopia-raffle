-- Append-only ledger of SOL/USDC sent from the Gen Owl rev-share pool.
-- Survives claim-row update failures so coverage can subtract orphaned outflows.

CREATE TABLE IF NOT EXISTS public.gen_owl_rev_share_pool_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_signature TEXT NOT NULL,
  recipient_wallet TEXT NOT NULL,
  amount_sol NUMERIC(20, 9) NOT NULL DEFAULT 0 CHECK (amount_sol >= 0),
  amount_usdc NUMERIC(20, 9) NOT NULL DEFAULT 0 CHECK (amount_usdc >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gen_owl_rev_share_pool_payouts_sig_unique UNIQUE (transaction_signature),
  CONSTRAINT gen_owl_rev_share_pool_payouts_has_amount CHECK (amount_sol > 0 OR amount_usdc > 0)
);

COMMENT ON TABLE public.gen_owl_rev_share_pool_payouts IS
  'Every successful rev-share pool payout signature. Used to detect orphan outflows when claim rows fail to record.';

CREATE INDEX IF NOT EXISTS idx_gen_owl_rev_share_pool_payouts_recipient
  ON public.gen_owl_rev_share_pool_payouts (recipient_wallet, created_at DESC);

ALTER TABLE public.gen_owl_rev_share_pool_payouts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gen_owl_rev_share_pool_payouts TO service_role;
