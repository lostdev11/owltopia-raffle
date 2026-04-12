-- Idempotent: same as migration 054. Some deployments applied 050 but never 054/051,
-- leaving CHECK constraints that require NFT min_tickets = 50 and break raffle creation.

ALTER TABLE public.raffles DROP CONSTRAINT IF EXISTS raffles_nft_min_tickets_fixed;
ALTER TABLE public.raffles DROP CONSTRAINT IF EXISTS raffles_nft_max_tickets_minimum;
ALTER TABLE public.raffles DROP CONSTRAINT IF EXISTS raffles_nft_prize_amount_null;
