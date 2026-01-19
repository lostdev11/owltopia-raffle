-- Add NFT transfer transaction signature field to raffles table
-- This allows admins to record the transaction signature when an NFT prize is transferred to the winner
-- This provides transparency and proof that the NFT was actually sent

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS nft_transfer_transaction TEXT;

-- Create index for NFT transfer transaction lookups
CREATE INDEX IF NOT EXISTS idx_raffles_nft_transfer_transaction ON raffles(nft_transfer_transaction) 
WHERE nft_transfer_transaction IS NOT NULL;
