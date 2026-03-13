-- V1 creator fee settlement fields on raffles

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS creator_wallet TEXT,
  ADD COLUMN IF NOT EXISTS fee_bps_applied INT,
  ADD COLUMN IF NOT EXISTS fee_tier_reason TEXT,
  ADD COLUMN IF NOT EXISTS platform_fee_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS creator_payout_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

