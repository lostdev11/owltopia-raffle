-- Audit ledger for admin deposits into the dedicated Gen Owl rev-share pool wallet.
-- Idempotent on transaction_signature so replaying the same tx cannot double-count.

CREATE TABLE IF NOT EXISTS public.gen_owl_rev_share_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month TEXT NOT NULL REFERENCES public.gen_owl_rev_share_periods (period_month) ON DELETE RESTRICT,
  currency TEXT NOT NULL CHECK (currency IN ('SOL', 'USDC')),
  amount NUMERIC(20, 9) NOT NULL CHECK (amount > 0),
  gen1_amount NUMERIC(20, 9) NOT NULL DEFAULT 0 CHECK (gen1_amount >= 0),
  gen2_amount NUMERIC(20, 9) NOT NULL DEFAULT 0 CHECK (gen2_amount >= 0),
  transaction_signature TEXT NOT NULL,
  depositor_wallet TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gen_owl_rev_share_deposits_sig_unique UNIQUE (transaction_signature),
  CONSTRAINT gen_owl_rev_share_deposits_period_month_format CHECK (period_month ~ '^\d{4}-\d{2}$'),
  CONSTRAINT gen_owl_rev_share_deposits_split_sum CHECK (
    abs((gen1_amount + gen2_amount) - amount) < 0.000000001
  )
);

COMMENT ON TABLE public.gen_owl_rev_share_deposits IS
  'Admin connected-wallet deposits into the Gen Owl rev-share pool. Each on-chain signature is recorded once.';

CREATE INDEX IF NOT EXISTS idx_gen_owl_rev_share_deposits_period
  ON public.gen_owl_rev_share_deposits (period_month DESC, created_at DESC);

ALTER TABLE public.gen_owl_rev_share_deposits ENABLE ROW LEVEL SECURITY;

-- API + service role only (no public read of deposit ops).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gen_owl_rev_share_deposits TO service_role;
