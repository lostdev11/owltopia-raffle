-- Add OWL to allowed raffle and entry currencies. Does not change existing rows.

-- Raffles: allow SOL, USDC, OWL
ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_currency_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_currency_check
  CHECK (currency IN ('USDC', 'SOL', 'OWL'));

-- Entries: allow SOL, USDC, OWL
ALTER TABLE entries
  DROP CONSTRAINT IF EXISTS entries_currency_check;

ALTER TABLE entries
  ADD CONSTRAINT entries_currency_check
  CHECK (currency IN ('USDC', 'SOL', 'OWL'));
