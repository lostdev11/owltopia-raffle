-- Canonical single staking perch: Owl Nest NFT · 365-day lock · 1 OWL/day per NFT (DB MVP).
-- Deactivates all other staking_pools rows so the app surfaces one shared option until admins re-enable more.

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
  lock_enforcement_source
)
VALUES (
  'Owltopia Coins NFT',
  'owl-nest-365',
  'One shared nest for everyone: stake an Owl Nest NFT for 365 days and earn 1 OWL per day per NFT (claim anytime from your dashboard).',
  'nft',
  NULL,
  '9KLamQmRoZsB9ymyLAvSDGYvd6yku7oCaUyxCYXFfwsx',
  'OWL',
  1,
  'daily',
  365,
  1,
  1,
  0,
  TRUE,
  0,
  NULL,
  'owl-nesting-canonical-migration',
  'mock',
  FALSE,
  FALSE,
  'database'
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  asset_type = EXCLUDED.asset_type,
  reward_token = EXCLUDED.reward_token,
  reward_rate = EXCLUDED.reward_rate,
  reward_rate_unit = EXCLUDED.reward_rate_unit,
  lock_period_days = EXCLUDED.lock_period_days,
  minimum_stake = EXCLUDED.minimum_stake,
  maximum_stake = EXCLUDED.maximum_stake,
  platform_fee_bps = EXCLUDED.platform_fee_bps,
  collection_key = EXCLUDED.collection_key,
  is_active = TRUE,
  display_order = EXCLUDED.display_order,
  adapter_mode = EXCLUDED.adapter_mode,
  is_onchain_enabled = EXCLUDED.is_onchain_enabled,
  requires_onchain_sync = EXCLUDED.requires_onchain_sync,
  lock_enforcement_source = EXCLUDED.lock_enforcement_source,
  updated_at = NOW();

UPDATE public.staking_pools
SET
  is_active = FALSE,
  updated_at = NOW()
WHERE slug IS DISTINCT FROM 'owl-nest-365';

UPDATE public.staking_pools
SET
  is_active = TRUE,
  updated_at = NOW()
WHERE slug = 'owl-nest-365';
