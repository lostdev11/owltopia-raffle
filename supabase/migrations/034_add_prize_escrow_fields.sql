-- Prize escrow: track when NFT prize was deposited to platform escrow (optional gating for go-live)

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS prize_deposited_at TIMESTAMPTZ;

COMMENT ON COLUMN raffles.prize_deposited_at IS 'When the NFT prize was verified in the platform prize escrow (for NFT raffles).';
