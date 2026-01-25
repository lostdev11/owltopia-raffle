-- ============================================================================
-- Migration 017: Add restored_at field to track restored entries
-- ============================================================================

-- Add restored_at timestamp to entries table
-- This tracks when an entry was restored via the verify-by-tx endpoint
ALTER TABLE entries 
ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS restored_by TEXT;

-- Create index for efficient queries on restored entries
CREATE INDEX IF NOT EXISTS idx_entries_restored_at ON entries(restored_at DESC) WHERE restored_at IS NOT NULL;

-- Create index for queries by wallet and restored status
CREATE INDEX IF NOT EXISTS idx_entries_wallet_restored ON entries(wallet_address, restored_at DESC) WHERE restored_at IS NOT NULL;
