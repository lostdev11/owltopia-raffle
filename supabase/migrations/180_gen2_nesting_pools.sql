-- Gen2 Owl staking ("nesting") — two optional lock tiers from the community vote:
--   gen2-nest-90  · 90-day lock  · 0.1 OWL/day per NFT
--   gen2-nest-180 · 180-day lock · 0.3 OWL/day per NFT  (longer lock = bigger bonus)
--
-- Locking is OPT-IN: an unlocked Gen2 owl simply earns nothing. Locking 90/180 days is also the gate
-- for the broader Gen2 revenue-share buckets (secondary sales / launchpad / staking-platform / game),
-- which are separate payout systems consuming the "has an active locked Gen2 position" signal.
--
-- INSERT-only for the two Gen2 perches. This migration NEVER touches `owl-nest-365` (the canonical
-- Owltopia Coins NFT perch) — no re-rate, no deactivate, no collection change. Seeded is_active = FALSE
-- so the public /nesting landing keeps surfacing the single Owltopia perch until the Gen2 UI ships;
-- admins can review/edit these in the admin pool list (which shows inactive pools) and flip them live.
--
-- Reward rates rely on the relaxed NFT emission band in lib/nesting/policy.ts (default 0..100 OWL/day).
-- adapter_mode mirrors the canonical perch (onchain_enabled / hybrid) so activation is freeze-backed.
-- NOTE: on-chain freeze for Gen2 also requires NESTING_NFT_FREEZE_AUTHORITY_* to hold freeze rights on
-- the Gen2 Core collection before these go live.

WITH gen2_collection AS (
  SELECT COALESCE(
    NULLIF(btrim((
      SELECT collection_mint
      FROM public.owl_center_launches
      WHERE slug = 'gen2'
      LIMIT 1
    )), ''),
    'GkLgT4KuwAPKeMSzfcPPmzuGimRNPvK1FWNPks4kzFVA'
  ) AS addr
),
gen2_pools (
  name,
  slug,
  description,
  reward_rate,
  lock_period_days,
  display_order
) AS (
  VALUES
    (
      'Gen2 Owl · 90-day nest',
      'gen2-nest-90',
      'Lock a Gen2 Owl for 90 days and earn 0.1 OWL per day per NFT (claim from your dashboard). Locking also unlocks Gen2 revenue share. Locking is optional — keep your owl unlocked to stay free anytime.',
      0.1::numeric,
      90,
      10
    ),
    (
      'Gen2 Owl · 180-day nest',
      'gen2-nest-180',
      'Lock a Gen2 Owl for 180 days and earn 0.3 OWL per day per NFT — the longer lock pays a bigger bonus. Locking also unlocks Gen2 revenue share. Locking is optional — keep your owl unlocked to stay free anytime.',
      0.3::numeric,
      180,
      11
    )
)
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
SELECT
  p.name,
  p.slug,
  p.description,
  'nft',
  NULL,
  gc.addr,
  'OWL',
  p.reward_rate,
  'daily',
  p.lock_period_days,
  1,
  1,
  0,
  FALSE,
  p.display_order,
  NULL,
  'gen2-nesting-pools-migration',
  'onchain_enabled',
  TRUE,
  FALSE,
  'hybrid'
FROM gen2_pools p
CROSS JOIN gen2_collection gc
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  asset_type = EXCLUDED.asset_type,
  collection_key = EXCLUDED.collection_key,
  reward_token = EXCLUDED.reward_token,
  reward_rate = EXCLUDED.reward_rate,
  reward_rate_unit = EXCLUDED.reward_rate_unit,
  lock_period_days = EXCLUDED.lock_period_days,
  minimum_stake = EXCLUDED.minimum_stake,
  maximum_stake = EXCLUDED.maximum_stake,
  platform_fee_bps = EXCLUDED.platform_fee_bps,
  display_order = EXCLUDED.display_order,
  adapter_mode = EXCLUDED.adapter_mode,
  is_onchain_enabled = EXCLUDED.is_onchain_enabled,
  requires_onchain_sync = EXCLUDED.requires_onchain_sync,
  lock_enforcement_source = EXCLUDED.lock_enforcement_source,
  -- Intentionally NOT overwriting is_active: once an admin flips a Gen2 perch live, re-running this
  -- migration must not silently deactivate it.
  updated_at = NOW();
