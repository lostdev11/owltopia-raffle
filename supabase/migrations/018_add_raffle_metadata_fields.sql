-- ============================================================================
-- Migration 018: Add optional metadata fields (rank and floor_price) to raffles
-- ============================================================================

-- Add rank column (text to support both text and integer values)
ALTER TABLE raffles 
ADD COLUMN IF NOT EXISTS rank TEXT;

-- Add floor_price column (text to support both text and numeric values)
ALTER TABLE raffles 
ADD COLUMN IF NOT EXISTS floor_price TEXT;

-- Add comments for documentation
COMMENT ON COLUMN raffles.rank IS 'Optional rank metadata field (text or integer)';
COMMENT ON COLUMN raffles.floor_price IS 'Optional floor price metadata field (text or numeric)';
