-- ============================================================================
-- 218: Owltopia Coin NFT art upgrade (community vote: optional paid upgrade).
-- Holder pays COIN_ART_UPGRADE_FEE_SOL (default 0.15 SOL) per coin; the server
-- repoints the MPL Core asset URI to the new Arweave art. Works while nested —
-- the FreezeDelegate nest lock only blocks transfers, not metadata updates.
-- Upgraded coins earn 2x nested OWL (position snapshot bump / stake-time multiplier).
-- Writes: Next.js API + service role only (migration 020 pattern).
-- ============================================================================

-- New-art catalog: one row per coin asset, seeded from the Irys upload manifest
-- (scripts/seed-coin-upgrade-catalog.mjs) before the upgrade goes live.
CREATE TABLE IF NOT EXISTS public.coin_art_upgrade_catalog (
  asset_id TEXT PRIMARY KEY,
  coin_number INTEGER,
  name TEXT,
  new_uri TEXT NOT NULL,
  new_image_uri TEXT,
  original_uri TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_coin_art_upgrade_catalog_updated_at ON public.coin_art_upgrade_catalog;
CREATE TRIGGER update_coin_art_upgrade_catalog_updated_at
  BEFORE UPDATE ON public.coin_art_upgrade_catalog
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Consume-once fee payments (staking_platform_fee_payments pattern):
-- one on-chain SOL transfer can cover several coins (units = lamports / per-coin fee).
CREATE TABLE IF NOT EXISTS public.coin_art_upgrade_payments (
  tx_signature TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  units INTEGER NOT NULL CHECK (units > 0),
  lamports BIGINT NOT NULL CHECK (lamports > 0),
  asset_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coin_art_upgrade_payments_wallet
  ON public.coin_art_upgrade_payments (wallet_address, created_at DESC);

-- One upgrade per coin, forever. Row is inserted as 'paid' BEFORE the on-chain
-- URI update so a mid-flight failure never loses the holder's payment — the
-- repair cron retries 'paid' / 'failed' rows until they reach 'updated'.
CREATE TABLE IF NOT EXISTS public.coin_art_upgrades (
  asset_id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  payment_tx_signature TEXT NOT NULL REFERENCES public.coin_art_upgrade_payments (tx_signature),
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'updated', 'failed')),
  previous_uri TEXT,
  new_uri TEXT NOT NULL,
  update_tx_signature TEXT,
  last_error TEXT,
  -- 2x nested-rewards bookkeeping: set once the open position snapshot was bumped
  -- (or once we confirmed there was no open position to bump).
  reward_boost_applied_at TIMESTAMPTZ,
  reward_boost_position_id UUID,
  upgraded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coin_art_upgrades_wallet
  ON public.coin_art_upgrades (wallet_address, created_at DESC);

-- Repair cron scan: unfinished on-chain updates / unapplied reward boosts.
CREATE INDEX IF NOT EXISTS idx_coin_art_upgrades_needs_repair
  ON public.coin_art_upgrades (updated_at)
  WHERE status IN ('paid', 'failed') OR reward_boost_applied_at IS NULL;

DROP TRIGGER IF EXISTS update_coin_art_upgrades_updated_at ON public.coin_art_upgrades;
CREATE TRIGGER update_coin_art_upgrades_updated_at
  BEFORE UPDATE ON public.coin_art_upgrades
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.coin_art_upgrade_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coin_art_upgrade_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coin_art_upgrades ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coin_art_upgrade_catalog TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coin_art_upgrade_payments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coin_art_upgrades TO service_role;

COMMENT ON TABLE public.coin_art_upgrade_catalog IS
  'New Owltopia coin art (Arweave URIs) per asset; seeded from the Irys upload manifest.';
COMMENT ON TABLE public.coin_art_upgrade_payments IS
  'On-chain SOL fees for coin art upgrades; one tx can cover several coins (units).';
COMMENT ON TABLE public.coin_art_upgrades IS
  'Per-coin art upgrade lifecycle: paid -> updated (Core URI repointed) with reward boost bookkeeping.';
COMMENT ON COLUMN public.coin_art_upgrades.reward_boost_applied_at IS
  'When the 2x nested-rewards boost was applied to the open position (or confirmed not needed).';
