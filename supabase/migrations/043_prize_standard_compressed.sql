-- Allow compressed (Bubblegum) NFT prizes in prize_standard
ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_prize_standard_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_prize_standard_check
  CHECK (prize_standard IN ('spl', 'token2022', 'mpl_core', 'compressed'));
