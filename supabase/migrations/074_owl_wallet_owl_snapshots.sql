-- Cached OWL SPL balances for Council UI eligibility (refresh at most every 7 days per wallet).
CREATE TABLE IF NOT EXISTS public.owl_wallet_owl_snapshots (
  wallet_address TEXT PRIMARY KEY,
  balance_raw NUMERIC(40, 0) NOT NULL CHECK (balance_raw >= 0),
  meets_min_proposal BOOLEAN NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owl_wallet_owl_snapshots_checked_at ON public.owl_wallet_owl_snapshots (checked_at);

COMMENT ON TABLE public.owl_wallet_owl_snapshots IS 'OWL balance snapshots for proposal-create eligibility UI; refreshed lazily or by cron; API uses service role.';

ALTER TABLE public.owl_wallet_owl_snapshots ENABLE ROW LEVEL SECURITY;
