-- Defense in depth: enforce NFT raffle ticket economics in the database.
-- API + RLS already block client writes; service role must still produce valid rows.
--
-- BEFORE applying on a database with existing NFT raffles, run the normalization script so no row
-- violates these checks (otherwise this migration will fail):
--   scripts/normalize-nft-raffle-economics.mjs (dry-run, then --apply with ALLOW_NFT_ECONOMICS_NORMALIZE=1 and --confirm-apply)

ALTER TABLE public.raffles
  DROP CONSTRAINT IF EXISTS raffles_nft_min_tickets_fixed;

ALTER TABLE public.raffles
  ADD CONSTRAINT raffles_nft_min_tickets_fixed
  CHECK (
    lower(coalesce(prize_type, '')) <> 'nft'
    OR min_tickets = 50
  );

ALTER TABLE public.raffles
  DROP CONSTRAINT IF EXISTS raffles_nft_max_tickets_minimum;

ALTER TABLE public.raffles
  ADD CONSTRAINT raffles_nft_max_tickets_minimum
  CHECK (
    lower(coalesce(prize_type, '')) <> 'nft'
    OR max_tickets IS NULL
    OR max_tickets >= 50
  );

ALTER TABLE public.raffles
  DROP CONSTRAINT IF EXISTS raffles_nft_prize_amount_null;

ALTER TABLE public.raffles
  ADD CONSTRAINT raffles_nft_prize_amount_null
  CHECK (
    lower(coalesce(prize_type, '')) <> 'nft'
    OR prize_amount IS NULL
  );
