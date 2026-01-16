-- Add CHECK constraints to restrict entry currencies to USDC and SOL only

-- Update raffles table to restrict currency to USDC or SOL
ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_currency_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_currency_check 
  CHECK (currency IN ('USDC', 'SOL'));

-- Update entries table to restrict currency to USDC or SOL
ALTER TABLE entries
  DROP CONSTRAINT IF EXISTS entries_currency_check;

ALTER TABLE entries
  ADD CONSTRAINT entries_currency_check 
  CHECK (currency IN ('USDC', 'SOL'));

-- Update default values if needed (they should already be 'SOL')
-- This is just to ensure consistency
ALTER TABLE raffles
  ALTER COLUMN currency SET DEFAULT 'SOL';

ALTER TABLE entries
  ALTER COLUMN currency SET DEFAULT 'SOL';
