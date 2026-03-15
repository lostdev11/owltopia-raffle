-- Prize return to creator: track when/why NFT was sent back (cancelled, wrong_nft, dispute, platform_error)

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS prize_returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prize_return_reason TEXT,
  ADD COLUMN IF NOT EXISTS prize_return_tx TEXT;

COMMENT ON COLUMN raffles.prize_returned_at IS 'When the NFT prize was returned from escrow to the creator (admin-only, reason in prize_return_reason).';
COMMENT ON COLUMN raffles.prize_return_reason IS 'Reason for returning prize: cancelled, wrong_nft, dispute, platform_error.';
COMMENT ON COLUMN raffles.prize_return_tx IS 'Solana transaction signature for the return transfer to creator.';
