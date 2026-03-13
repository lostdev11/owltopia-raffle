-- V1 platform fee tracking on raffles
-- Tracks platform fee in basis points (BPS) and amount at settlement time.
-- Fees are computed when a raffle settles (winner selected) based on creator holder status.

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS platform_fee_bps INTEGER,
  ADD COLUMN IF NOT EXISTS platform_fee_amount DECIMAL(12, 6),
  ADD COLUMN IF NOT EXISTS platform_fee_currency TEXT,
  ADD COLUMN IF NOT EXISTS platform_fee_settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS platform_fee_creator_is_holder BOOLEAN;

