-- Store the transaction signature when the creator deposits the NFT to escrow.
-- Used to identify which mint belongs to this raffle when escrow holds multiple NFTs.

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS prize_deposit_tx TEXT;

COMMENT ON COLUMN raffles.prize_deposit_tx IS 'Solana tx signature when creator transferred NFT to prize escrow. Used to identify mint when escrow holds multiple NFTs.';
