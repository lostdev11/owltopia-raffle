-- ============================================================================
-- 076: Owl Nesting — DB-backed staking (MVP scaffolding; no on-chain locks yet).
-- Writes: Next.js API + service role (migration 020 pattern).
-- Zero RPC: all state in Supabase; future Solana verification in app layer only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.staking_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('nft', 'token')),
  token_mint TEXT,
  collection_key TEXT,
  reward_token TEXT,
  reward_rate NUMERIC NOT NULL DEFAULT 0 CHECK (reward_rate >= 0),
  reward_rate_unit TEXT NOT NULL DEFAULT 'daily' CHECK (reward_rate_unit IN ('hourly', 'daily', 'weekly')),
  lock_period_days INTEGER NOT NULL DEFAULT 0 CHECK (lock_period_days >= 0),
  minimum_stake NUMERIC CHECK (minimum_stake IS NULL OR minimum_stake >= 0),
  maximum_stake NUMERIC CHECK (maximum_stake IS NULL OR maximum_stake >= 0),
  platform_fee_bps INTEGER NOT NULL DEFAULT 0 CHECK (platform_fee_bps >= 0 AND platform_fee_bps <= 10000),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  partner_project_slug TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT staking_pools_slug_unique UNIQUE (slug),
  CONSTRAINT staking_pools_min_max CHECK (
    minimum_stake IS NULL OR maximum_stake IS NULL OR minimum_stake <= maximum_stake
  )
);

CREATE INDEX IF NOT EXISTS idx_staking_pools_active ON public.staking_pools (is_active);
CREATE INDEX IF NOT EXISTS idx_staking_pools_display_order ON public.staking_pools (display_order);

DROP TRIGGER IF EXISTS update_staking_pools_updated_at ON public.staking_pools;
CREATE TRIGGER update_staking_pools_updated_at
  BEFORE UPDATE ON public.staking_pools
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.staking_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  pool_id UUID NOT NULL REFERENCES public.staking_pools (id) ON DELETE CASCADE,
  asset_identifier TEXT,
  amount NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  reward_rate_snapshot NUMERIC NOT NULL DEFAULT 0,
  reward_rate_unit_snapshot TEXT NOT NULL DEFAULT 'daily' CHECK (
    reward_rate_unit_snapshot IN ('hourly', 'daily', 'weekly')
  ),
  reward_token_snapshot TEXT,
  staked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unlock_at TIMESTAMPTZ,
  unstaked_at TIMESTAMPTZ,
  claimed_rewards NUMERIC NOT NULL DEFAULT 0 CHECK (claimed_rewards >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'unstaked', 'pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staking_positions_wallet ON public.staking_positions (wallet_address);
CREATE INDEX IF NOT EXISTS idx_staking_positions_pool ON public.staking_positions (pool_id);
CREATE INDEX IF NOT EXISTS idx_staking_positions_status ON public.staking_positions (status);

DROP TRIGGER IF EXISTS update_staking_positions_updated_at ON public.staking_positions;
CREATE TRIGGER update_staking_positions_updated_at
  BEFORE UPDATE ON public.staking_positions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.staking_reward_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id UUID NOT NULL REFERENCES public.staking_positions (id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('accrual', 'claim', 'adjustment')),
  amount NUMERIC NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staking_reward_events_position ON public.staking_reward_events (position_id);
CREATE INDEX IF NOT EXISTS idx_staking_reward_events_wallet ON public.staking_reward_events (wallet_address);

ALTER TABLE public.staking_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staking_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staking_reward_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active staking pools" ON public.staking_pools;
CREATE POLICY "Public can read active staking pools"
  ON public.staking_pools
  FOR SELECT
  TO anon, authenticated
  USING (is_active = TRUE);

-- Positions / events: no anon/authenticated SELECT — reads go through Next.js API + service role after SIWS session.

GRANT SELECT ON public.staking_pools TO anon, authenticated;

COMMENT ON TABLE public.staking_pools IS 'Owl Nesting pools; admin mutations via Next.js API + service role.';
COMMENT ON TABLE public.staking_positions IS 'DB-backed positions; MVP; future on-chain adapter.';
COMMENT ON COLUMN public.staking_positions.reward_rate_unit_snapshot IS 'Copied at stake time so pool edits do not retroactively change accrual math.';
COMMENT ON TABLE public.staking_reward_events IS 'Audit trail for accrual / claim / adjustment.';
COMMENT ON COLUMN public.staking_pools.partner_project_slug IS 'Optional; reserved for partner-branded pools later.';
