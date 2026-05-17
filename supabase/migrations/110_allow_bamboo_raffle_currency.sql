-- Allow PNDA Partner Pro Bamboo ticket raffles.
-- App-level create checks restrict Bamboo raffle creation to the PNDA wallet and admins.

ALTER TABLE public.raffles
  DROP CONSTRAINT IF EXISTS raffles_currency_check;

ALTER TABLE public.raffles
  ADD CONSTRAINT raffles_currency_check
  CHECK (currency IN ('USDC', 'SOL', 'OWL', 'BAMBOO'));

ALTER TABLE public.entries
  DROP CONSTRAINT IF EXISTS entries_currency_check;

ALTER TABLE public.entries
  ADD CONSTRAINT entries_currency_check
  CHECK (currency IN ('USDC', 'SOL', 'OWL', 'BAMBOO'));
