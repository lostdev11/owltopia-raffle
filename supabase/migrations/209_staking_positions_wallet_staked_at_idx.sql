-- Speed up GET /api/me/staking/positions wallet list (eq wallet_address + order staked_at desc).
-- Existing idx_staking_positions_wallet helps the filter; this covers the common sort too.

CREATE INDEX IF NOT EXISTS idx_staking_positions_wallet_staked_at
  ON public.staking_positions (wallet_address, staked_at DESC);
