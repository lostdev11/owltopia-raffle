-- Gen 1 Owltopia owl staking perches (90d / 180d). Admin-only preview until public launch.
-- collection_key is filled at runtime from OWLTOPIA_COLLECTION_ADDRESS via ensureGen1StakingPoolsReady().

ALTER TABLE public.staking_pools
  ADD COLUMN IF NOT EXISTS admin_only BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.staking_pools.admin_only IS
  'When true, pool is visible and stakeable only by site admins (preview / QA before public launch).';

INSERT INTO public.staking_pools (
  name,
  slug,
  description,
  asset_type,
  token_mint,
  collection_key,
  reward_token,
  reward_rate,
  reward_rate_unit,
  lock_period_days,
  minimum_stake,
  maximum_stake,
  platform_fee_bps,
  is_active,
  display_order,
  partner_project_slug,
  created_by,
  adapter_mode,
  is_onchain_enabled,
  requires_onchain_sync,
  lock_enforcement_source,
  admin_only
)
VALUES
  (
    'Gen 1 Owl · 90-day nest',
    'gen1-owl-90d',
    'Stake an original Owltopia Gen 1 owl for 90 days. Earn 0.2 OWL per day per NFT. Admin preview — not public yet.',
    'nft',
    NULL,
    NULL,
    'OWL',
    0.2,
    'daily',
    90,
    1,
    1,
    0,
    TRUE,
    0,
    NULL,
    'gen1-staking-migration',
    'onchain_enabled',
    TRUE,
    FALSE,
    'hybrid',
    TRUE
  ),
  (
    'Gen 1 Owl · 180-day nest',
    'gen1-owl-180d',
    'Stake an original Owltopia Gen 1 owl for 180 days. Earn 0.4 OWL per day per NFT. Admin preview — not public yet.',
    'nft',
    NULL,
    NULL,
    'OWL',
    0.4,
    'daily',
    180,
    1,
    1,
    0,
    TRUE,
    1,
    NULL,
    'gen1-staking-migration',
    'onchain_enabled',
    TRUE,
    FALSE,
    'hybrid',
    TRUE
  )
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  reward_token = EXCLUDED.reward_token,
  reward_rate = EXCLUDED.reward_rate,
  reward_rate_unit = EXCLUDED.reward_rate_unit,
  lock_period_days = EXCLUDED.lock_period_days,
  minimum_stake = EXCLUDED.minimum_stake,
  maximum_stake = EXCLUDED.maximum_stake,
  is_active = TRUE,
  display_order = EXCLUDED.display_order,
  adapter_mode = EXCLUDED.adapter_mode,
  is_onchain_enabled = EXCLUDED.is_onchain_enabled,
  requires_onchain_sync = EXCLUDED.requires_onchain_sync,
  lock_enforcement_source = EXCLUDED.lock_enforcement_source,
  admin_only = EXCLUDED.admin_only,
  updated_at = NOW();

-- Keep Owltopia Coins perch after Gen 1 tiers in the perch list.
UPDATE public.staking_pools
SET display_order = 10, updated_at = NOW()
WHERE slug = 'owl-nest-365'
  AND display_order < 10;
