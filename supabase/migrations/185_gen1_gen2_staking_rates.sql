-- Gembird-approved tier rates (Jul 2026):
-- Gen 1: 90d 0.2 OWL/day, 180d 0.6 OWL/day
-- Gen 2: 90d 0.1 OWL/day, 180d 0.3 OWL/day
-- collection_key filled at runtime from env via ensureGen1/Gen2StakingPoolsReady().

UPDATE public.staking_pools
SET
  description = 'Stake an original Owltopia Gen 1 owl for 90 days. Earn 0.2 OWL per day per NFT.',
  reward_rate = 0.2,
  updated_at = NOW()
WHERE slug = 'gen1-owl-90d';

UPDATE public.staking_pools
SET
  description = 'Stake an original Owltopia Gen 1 owl for 180 days. Earn 0.6 OWL per day per NFT.',
  reward_rate = 0.6,
  updated_at = NOW()
WHERE slug = 'gen1-owl-180d';

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
    'Gen 2 Owl · 90-day nest',
    'gen2-owl-90d',
    'Stake an Owltopia Gen 2 owl for 90 days. Earn 0.1 OWL per day per NFT. Admin preview until public launch.',
    'nft',
    NULL,
    NULL,
    'OWL',
    0.1,
    'daily',
    90,
    1,
    1,
    0,
    TRUE,
    2,
    NULL,
    'gen2-staking-migration',
    'onchain_enabled',
    TRUE,
    FALSE,
    'hybrid',
    TRUE
  ),
  (
    'Gen 2 Owl · 180-day nest',
    'gen2-owl-180d',
    'Stake an Owltopia Gen 2 owl for 180 days. Earn 0.3 OWL per day per NFT. Admin preview until public launch.',
    'nft',
    NULL,
    NULL,
    'OWL',
    0.3,
    'daily',
    180,
    1,
    1,
    0,
    TRUE,
    3,
    NULL,
    'gen2-staking-migration',
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
  updated_at = NOW();
