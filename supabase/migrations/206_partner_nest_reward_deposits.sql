-- Partner Nesting reward funding: partners deposit SPL into the platform reward vault ATA;
-- nesters claim from that funded balance. Ledger is idempotent on transaction_signature.

ALTER TABLE public.staking_pools
  ADD COLUMN IF NOT EXISTS partner_reward_funded NUMERIC NOT NULL DEFAULT 0
    CHECK (partner_reward_funded >= 0),
  ADD COLUMN IF NOT EXISTS partner_reward_paid NUMERIC NOT NULL DEFAULT 0
    CHECK (partner_reward_paid >= 0),
  ADD COLUMN IF NOT EXISTS reward_decimals INTEGER
    CHECK (reward_decimals IS NULL OR (reward_decimals >= 0 AND reward_decimals <= 18));

COMMENT ON COLUMN public.staking_pools.partner_reward_funded IS
  'Cumulative partner SPL deposited (UI units) for partner_token reward perches.';
COMMENT ON COLUMN public.staking_pools.partner_reward_paid IS
  'Cumulative partner SPL paid out to nesters (UI units). Available = funded - paid.';
COMMENT ON COLUMN public.staking_pools.reward_decimals IS
  'Optional decimals for pool.reward_mint (copied from partner nest application on approve).';

CREATE TABLE IF NOT EXISTS public.partner_nest_reward_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES public.staking_pools (id) ON DELETE CASCADE,
  reward_mint TEXT NOT NULL,
  amount NUMERIC(28, 9) NOT NULL CHECK (amount > 0),
  transaction_signature TEXT NOT NULL,
  depositor_wallet TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT partner_nest_reward_deposits_sig_unique UNIQUE (transaction_signature)
);

CREATE INDEX IF NOT EXISTS idx_partner_nest_reward_deposits_pool
  ON public.partner_nest_reward_deposits (pool_id, created_at DESC);

ALTER TABLE public.partner_nest_reward_deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_nest_reward_deposits_deny_all ON public.partner_nest_reward_deposits;
CREATE POLICY partner_nest_reward_deposits_deny_all
  ON public.partner_nest_reward_deposits
  FOR ALL
  USING (false)
  WITH CHECK (false);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_nest_reward_deposits TO service_role;

COMMENT ON TABLE public.partner_nest_reward_deposits IS
  'Partner connected-wallet SPL deposits into the Nesting reward vault ATA for a partner_token perch.';
