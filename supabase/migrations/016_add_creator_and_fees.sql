-- Add creator + fee columns to raffles table
-- Aligns with existing created_by (wallet); adds created_by_wallet, payout, and fee tracking.
-- Safe to re-run: uses IF NOT EXISTS / DROP IF EXISTS.

-- ============================================================================
-- 1) Creator + fee columns
-- ============================================================================
ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS created_by_wallet TEXT;

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS creator_payout_wallet TEXT;

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS platform_fee_bps INTEGER NOT NULL DEFAULT 500;

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS creator_share_bps INTEGER NOT NULL DEFAULT 9500;

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS creation_fee_usdc NUMERIC NOT NULL DEFAULT 1;

-- BPS: 0–10000 (10000 = 100%)
ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_platform_fee_bps_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_platform_fee_bps_check
  CHECK (platform_fee_bps >= 0 AND platform_fee_bps <= 10000);

ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_creator_share_bps_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_creator_share_bps_check
  CHECK (creator_share_bps >= 0 AND creator_share_bps <= 10000);

ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_creation_fee_usdc_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_creation_fee_usdc_check
  CHECK (creation_fee_usdc >= 0);

-- ============================================================================
-- 2) Earnings tracking (for manual or automated payouts)
-- ============================================================================
ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS gross_sales_usdc NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS platform_earnings_usdc NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS creator_earnings_usdc NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_gross_sales_usdc_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_gross_sales_usdc_check
  CHECK (gross_sales_usdc >= 0);

ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_platform_earnings_usdc_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_platform_earnings_usdc_check
  CHECK (platform_earnings_usdc >= 0);

ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_creator_earnings_usdc_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_creator_earnings_usdc_check
  CHECK (creator_earnings_usdc >= 0);

-- ============================================================================
-- 3) Indexes for creator lookups
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_raffles_created_by_wallet ON raffles(created_by_wallet)
  WHERE created_by_wallet IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_raffles_creator_payout_wallet ON raffles(creator_payout_wallet)
  WHERE creator_payout_wallet IS NOT NULL;

-- ============================================================================
-- 4) Trigger: default created_by_wallet and creator_payout_wallet on INSERT
--    Uses created_by (existing) when created_by_wallet not set.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_creator_payout_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Sync created_by_wallet from created_by if not provided (matches current API)
  IF NEW.created_by_wallet IS NULL AND NEW.created_by IS NOT NULL THEN
    NEW.created_by_wallet := NEW.created_by;
  END IF;
  -- Default creator_payout_wallet to created_by_wallet (or created_by) if not set
  IF NEW.creator_payout_wallet IS NULL THEN
    NEW.creator_payout_wallet := COALESCE(NEW.created_by_wallet, NEW.created_by);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_creator_payout_wallet ON raffles;

CREATE TRIGGER trg_set_creator_payout_wallet
  BEFORE INSERT ON raffles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_creator_payout_wallet();

-- ============================================================================
-- 5) Backfill created_by_wallet from created_by for existing rows
-- ============================================================================
UPDATE raffles
SET created_by_wallet = created_by
WHERE created_by_wallet IS NULL AND created_by IS NOT NULL;

UPDATE raffles
SET creator_payout_wallet = COALESCE(creator_payout_wallet, created_by_wallet, created_by)
WHERE creator_payout_wallet IS NULL AND (created_by_wallet IS NOT NULL OR created_by IS NOT NULL);
