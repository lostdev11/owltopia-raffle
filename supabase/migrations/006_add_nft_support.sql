-- Add NFT support to raffles table
-- This migration adds fields to support NFT prizes in addition to crypto prizes

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
ALTER TABLE raffles
  ALTER COLUMN prize_amount DROP NOT NULL;

ALTER TABLE raffles
  ALTER COLUMN prize_currency DROP NOT NULL;

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
