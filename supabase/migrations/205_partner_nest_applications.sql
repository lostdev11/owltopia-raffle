-- Partner Nesting applications: self-serve collection + optional partner reward token.
-- Partners submit; Owl Vision admins accept (provisions staking_pools) or reject.
-- Writes: Next.js API + service role only (deny-all RLS).

CREATE TABLE IF NOT EXISTS public.partner_nest_applications (
  id BIGSERIAL PRIMARY KEY,
  creator_wallet TEXT NOT NULL,
  collection_key TEXT NOT NULL,
  pool_name TEXT,
  partner_slug TEXT,
  locked BOOLEAN NOT NULL DEFAULT TRUE,
  max_lock_days INTEGER NOT NULL DEFAULT 90 CHECK (max_lock_days >= 0),
  min_lock_days INTEGER NOT NULL DEFAULT 30 CHECK (min_lock_days >= 0),
  nft_lock_standard TEXT NOT NULL DEFAULT 'auto'
    CHECK (nft_lock_standard IN ('auto', 'mpl_core_freeze_delegate', 'spl_token_account_freeze')),
  -- Optional partner reward token (holders earn this instead of / in addition to platform OWL when approved as partner_token).
  reward_mode_requested TEXT NOT NULL DEFAULT 'platform_owl'
    CHECK (reward_mode_requested IN ('platform_owl', 'partner_token')),
  reward_token_symbol TEXT,
  reward_mint TEXT,
  reward_decimals INTEGER CHECK (reward_decimals IS NULL OR (reward_decimals >= 0 AND reward_decimals <= 18)),
  reward_rate NUMERIC NOT NULL DEFAULT 1 CHECK (reward_rate >= 0),
  reward_rate_unit TEXT NOT NULL DEFAULT 'daily' CHECK (reward_rate_unit IN ('hourly', 'daily', 'weekly')),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'active', 'closed')),
  rejection_reason TEXT,
  approved_at TIMESTAMPTZ,
  approved_pool_id UUID REFERENCES public.staking_pools (id) ON DELETE SET NULL,
  approved_reward_mode TEXT
    CHECK (approved_reward_mode IS NULL OR approved_reward_mode IN ('platform_owl', 'partner_token')),
  reviewed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT partner_nest_applications_min_max_lock CHECK (min_lock_days <= max_lock_days)
);

CREATE INDEX IF NOT EXISTS idx_partner_nest_applications_status
  ON public.partner_nest_applications (status);
CREATE INDEX IF NOT EXISTS idx_partner_nest_applications_wallet
  ON public.partner_nest_applications (creator_wallet);
CREATE INDEX IF NOT EXISTS idx_partner_nest_applications_created
  ON public.partner_nest_applications (created_at DESC);

DROP TRIGGER IF EXISTS update_partner_nest_applications_updated_at ON public.partner_nest_applications;
CREATE TRIGGER update_partner_nest_applications_updated_at
  BEFORE UPDATE ON public.partner_nest_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.partner_nest_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_nest_applications_deny_all ON public.partner_nest_applications;
CREATE POLICY partner_nest_applications_deny_all
  ON public.partner_nest_applications
  FOR ALL
  USING (false)
  WITH CHECK (false);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_nest_applications TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.partner_nest_applications_id_seq TO service_role;

COMMENT ON TABLE public.partner_nest_applications IS
  'Partner self-serve Nesting requests: NFT collection + optional partner reward SPL mint. Admins approve → staking_pools row.';
COMMENT ON COLUMN public.partner_nest_applications.reward_mode_requested IS
  'platform_owl = earn OWL from Owltopia treasury; partner_token = partner SPL mint (stored on pool when approved as partner_token).';
COMMENT ON COLUMN public.partner_nest_applications.reward_mint IS
  'Optional SPL mint partners want holders rewarded with. Reviewed by admin on approve.';
