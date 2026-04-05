-- Idempotent: remove migration 050 constraints if they are still present.
-- Without this, changing NFT min_tickets away from 50 fails with a check constraint
-- and the API returns 500 ("internal server error").

ALTER TABLE public.raffles DROP CONSTRAINT IF EXISTS raffles_nft_min_tickets_fixed;
ALTER TABLE public.raffles DROP CONSTRAINT IF EXISTS raffles_nft_max_tickets_minimum;
ALTER TABLE public.raffles DROP CONSTRAINT IF EXISTS raffles_nft_prize_amount_null;
