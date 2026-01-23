-- Combined migration file to apply all missing migrations (006-015)
-- This file can be safely run even if some migrations have already been applied
-- All statements use IF NOT EXISTS or DROP IF EXISTS to prevent errors

-- ============================================================================
-- Migration 006: Add NFT support to raffles table
-- ============================================================================
-- Add prize_type to distinguish between NFT and crypto prizes
ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS prize_type TEXT NOT NULL DEFAULT 'crypto';

-- Add CHECK constraint for prize_type
ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_prize_type_enum_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_prize_type_enum_check 
  CHECK (prize_type IN ('crypto', 'nft'));

-- Add NFT-specific fields
ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS nft_mint_address TEXT;

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS nft_collection_name TEXT;

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS nft_token_id TEXT;

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS nft_metadata_uri TEXT;

-- Make prize_amount and prize_currency nullable for NFT prizes
-- (They should only be required for crypto prizes)
DO $$
BEGIN
  -- Check if prize_amount has NOT NULL constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'raffles' 
    AND column_name = 'prize_amount' 
    AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE raffles ALTER COLUMN prize_amount DROP NOT NULL;
  END IF;
  
  -- Check if prize_currency has NOT NULL constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'raffles' 
    AND column_name = 'prize_currency' 
    AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE raffles ALTER COLUMN prize_currency DROP NOT NULL;
  END IF;
END $$;

-- Add constraint to ensure crypto prizes have amount and currency
-- NFT prizes should have mint address or token ID
ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_prize_type_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_prize_type_check 
  CHECK (
    (prize_type = 'crypto' AND prize_amount IS NOT NULL AND prize_currency IS NOT NULL) OR
    (prize_type = 'nft' AND (nft_mint_address IS NOT NULL OR nft_token_id IS NOT NULL))
  );

-- Create index for NFT mint address lookups
CREATE INDEX IF NOT EXISTS idx_raffles_nft_mint_address ON raffles(nft_mint_address) 
WHERE nft_mint_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_raffles_prize_type ON raffles(prize_type);

-- ============================================================================
-- Migration 007: Add max_tickets field to raffles table
-- ============================================================================
ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS max_tickets INTEGER;

-- Add a check constraint to ensure max_tickets is positive if set
ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_max_tickets_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_max_tickets_check 
  CHECK (max_tickets IS NULL OR max_tickets > 0);

-- Create index for max_tickets lookups
CREATE INDEX IF NOT EXISTS idx_raffles_max_tickets ON raffles(max_tickets) 
WHERE max_tickets IS NOT NULL;

-- ============================================================================
-- Migration 008: Add INSERT and UPDATE policies for raffles table
-- ============================================================================
-- Drop existing policies if they exist (for re-running)
DROP POLICY IF EXISTS "Allow inserts to raffles" ON raffles;
DROP POLICY IF EXISTS "Allow updates to raffles" ON raffles;

-- Allow INSERT for all requests (API validates admin status)
CREATE POLICY "Allow inserts to raffles" ON raffles
  FOR INSERT WITH CHECK (true);

-- Allow UPDATE for all requests (API validates admin status)
CREATE POLICY "Allow updates to raffles" ON raffles
  FOR UPDATE USING (true) WITH CHECK (true);

-- ============================================================================
-- Migration 009: Add UPDATE policy for entries table
-- ============================================================================
-- Drop existing policy if it exists (for re-running)
DROP POLICY IF EXISTS "Allow updates to entries" ON entries;

-- Allow UPDATE for all requests (API validates transaction before updating)
CREATE POLICY "Allow updates to entries" ON entries
  FOR UPDATE USING (true) WITH CHECK (true);

-- ============================================================================
-- Migration 010: Add DELETE policy for raffles table
-- ============================================================================
-- Drop existing policy if it exists (for re-running)
DROP POLICY IF EXISTS "Allow deletes to raffles" ON raffles;

-- Allow DELETE for all requests (API validates admin status)
CREATE POLICY "Allow deletes to raffles" ON raffles
  FOR DELETE USING (true);

-- ============================================================================
-- Migration 011: Ensure entries are globally viewable
-- ============================================================================
-- Drop any existing SELECT policies that might restrict viewing
DROP POLICY IF EXISTS "Users can view entries for raffles" ON entries;
DROP POLICY IF EXISTS "Anyone can view all entries" ON entries;

-- Create a clear global SELECT policy for entries
CREATE POLICY "Anyone can view all entries" ON entries
  FOR SELECT USING (true);

-- ============================================================================
-- Migration 012: Add min_tickets and status fields to raffles table
-- ============================================================================
-- Add min_tickets field
ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS min_tickets INTEGER;

-- Add a check constraint to ensure min_tickets is positive if set
ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_min_tickets_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_min_tickets_check 
  CHECK (min_tickets IS NULL OR min_tickets > 0);

-- Add status field to track raffle state
ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS status TEXT;

-- Add CHECK constraint for status enum
ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_status_enum_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_status_enum_check 
  CHECK (status IS NULL OR status IN ('pending_min_not_met', 'completed'));

-- Create index for status lookups
CREATE INDEX IF NOT EXISTS idx_raffles_status ON raffles(status) 
WHERE status IS NOT NULL;

-- Create index for min_tickets lookups
CREATE INDEX IF NOT EXISTS idx_raffles_min_tickets ON raffles(min_tickets) 
WHERE min_tickets IS NOT NULL;

-- ============================================================================
-- Migration 013: Add DELETE policy for entries table
-- ============================================================================
-- Drop existing policy if it exists (for re-running)
DROP POLICY IF EXISTS "Allow deletes to entries" ON entries;

-- Allow DELETE for all requests (API validates admin status)
CREATE POLICY "Allow deletes to entries" ON entries
  FOR DELETE USING (true);

-- ============================================================================
-- Migration 014: Add NFT transfer transaction signature field
-- ============================================================================
ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS nft_transfer_transaction TEXT;

-- Create index for NFT transfer transaction lookups
CREATE INDEX IF NOT EXISTS idx_raffles_nft_transfer_transaction ON raffles(nft_transfer_transaction) 
WHERE nft_transfer_transaction IS NOT NULL;

-- ============================================================================
-- Migration 015: Add original_end_time field to raffles table
-- ============================================================================
ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS original_end_time TIMESTAMPTZ;

-- Create index for original_end_time lookups
CREATE INDEX IF NOT EXISTS idx_raffles_original_end_time ON raffles(original_end_time) 
WHERE original_end_time IS NOT NULL;
