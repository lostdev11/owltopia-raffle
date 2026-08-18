-- Part 1/4: column + constraints (run this first)
-- Safe to re-run.

ALTER TABLE public.raffles
  ADD COLUMN IF NOT EXISTS max_tickets_per_wallet INTEGER;

ALTER TABLE public.raffles
  DROP CONSTRAINT IF EXISTS raffles_max_tickets_per_wallet_check;

ALTER TABLE public.raffles
  ADD CONSTRAINT raffles_max_tickets_per_wallet_check
  CHECK (max_tickets_per_wallet IS NULL OR max_tickets_per_wallet > 0);

ALTER TABLE public.raffles
  DROP CONSTRAINT IF EXISTS raffles_max_tickets_per_wallet_lte_max_check;

ALTER TABLE public.raffles
  ADD CONSTRAINT raffles_max_tickets_per_wallet_lte_max_check
  CHECK (
    max_tickets IS NULL
    OR max_tickets_per_wallet IS NULL
    OR max_tickets_per_wallet <= max_tickets
  );

CREATE INDEX IF NOT EXISTS idx_raffles_max_tickets_per_wallet
  ON public.raffles (max_tickets_per_wallet)
  WHERE max_tickets_per_wallet IS NOT NULL;

COMMENT ON COLUMN public.raffles.max_tickets_per_wallet IS
  'Optional max confirmed tickets any single wallet may hold for this raffle. NULL = unlimited per wallet.';
