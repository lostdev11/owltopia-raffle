-- Prevent concurrent/duplicate claims from attempting multiple NFT transfers.
-- Winner can claim exactly once; we use a short-lived DB lock to avoid
-- "double-send" attempts when two browser tabs click at the same time.

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS nft_claim_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nft_claim_locked_wallet TEXT;

COMMENT ON COLUMN raffles.nft_claim_locked_at IS
  'When an NFT winner-claim started (used as a lock to prevent concurrent transfers).';
COMMENT ON COLUMN raffles.nft_claim_locked_wallet IS
  'Wallet address that currently holds the NFT claim lock.';

CREATE INDEX IF NOT EXISTS idx_raffles_nft_claim_locked_at
  ON raffles(nft_claim_locked_at)
  WHERE nft_claim_locked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_raffles_nft_claim_locked_wallet
  ON raffles(nft_claim_locked_wallet)
  WHERE nft_claim_locked_wallet IS NOT NULL;

