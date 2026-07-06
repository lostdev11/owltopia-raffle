-- Monthly Gen 1 / Gen 2 nest rev share: admin sets pool per month; nesters claim after month ends.

CREATE TABLE IF NOT EXISTS public.gen_owl_rev_share_periods (
  period_month TEXT PRIMARY KEY,
  gen1_total_sol NUMERIC(20, 9),
  gen1_total_usdc NUMERIC(20, 2),
  gen2_total_sol NUMERIC(20, 9),
  gen2_total_usdc NUMERIC(20, 2),
  gen1_eligible_count INT,
  gen2_eligible_count INT,
  gen1_per_nest_sol NUMERIC(20, 9),
  gen1_per_nest_usdc NUMERIC(20, 2),
  gen2_per_nest_sol NUMERIC(20, 9),
  gen2_per_nest_usdc NUMERIC(20, 2),
  finalized_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gen_owl_rev_share_period_month_format CHECK (period_month ~ '^\d{4}-\d{2}$')
);

COMMENT ON TABLE public.gen_owl_rev_share_periods IS
  'Monthly rev share pools for Gen 1 / Gen 2 nests. Finalized at month-end; claims open on the 1st of the next month UTC.';

CREATE TABLE IF NOT EXISTS public.gen_owl_rev_share_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month TEXT NOT NULL REFERENCES public.gen_owl_rev_share_periods (period_month) ON DELETE RESTRICT,
  position_id UUID NOT NULL REFERENCES public.staking_positions (id) ON DELETE RESTRICT,
  wallet_address TEXT NOT NULL,
  group_key TEXT NOT NULL CHECK (group_key IN ('gen1-owl', 'gen2-owl')),
  amount_sol NUMERIC(20, 9) NOT NULL DEFAULT 0,
  amount_usdc NUMERIC(20, 2) NOT NULL DEFAULT 0,
  sol_transaction_signature TEXT,
  usdc_transaction_signature TEXT,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gen_owl_rev_share_claims_unique_position_period UNIQUE (period_month, position_id)
);

CREATE INDEX IF NOT EXISTS idx_gen_owl_rev_share_claims_wallet
  ON public.gen_owl_rev_share_claims (wallet_address, period_month DESC);

ALTER TABLE public.gen_owl_rev_share_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gen_owl_rev_share_claims ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_gen_owl_rev_share_periods_updated_at
  BEFORE UPDATE ON public.gen_owl_rev_share_periods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

GRANT SELECT ON public.gen_owl_rev_share_periods TO anon, authenticated;
GRANT SELECT ON public.gen_owl_rev_share_claims TO anon, authenticated;
GRANT ALL ON public.gen_owl_rev_share_periods TO service_role;
GRANT ALL ON public.gen_owl_rev_share_claims TO service_role;
