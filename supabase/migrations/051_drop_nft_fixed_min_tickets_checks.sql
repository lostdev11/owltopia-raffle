-- Revert migration 050: NFT draw goal is derived from floor_price ÷ ticket_price (variable), not fixed at 50.

ALTER TABLE public.raffles DROP CONSTRAINT IF EXISTS raffles_nft_min_tickets_fixed;
ALTER TABLE public.raffles DROP CONSTRAINT IF EXISTS raffles_nft_max_tickets_minimum;
ALTER TABLE public.raffles DROP CONSTRAINT IF EXISTS raffles_nft_prize_amount_null;
