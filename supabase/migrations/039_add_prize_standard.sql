-- Add prize_standard to distinguish how NFT prizes are represented on-chain
-- 'spl'       = classic SPL Token (Tokenkeg)
-- 'token2022' = Token-2022 program
-- 'mpl_core'  = Metaplex Core / pNFT-style assets

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS prize_standard TEXT NOT NULL DEFAULT 'spl';

ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_prize_standard_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_prize_standard_check
  CHECK (prize_standard IN ('spl', 'token2022', 'mpl_core'));

