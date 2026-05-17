-- Optional second ticket currency (SOL + BAMBOO) on one raffle so partners do not need
-- two listings for the same SPL prize (app-layer duplicate rule is per prize_currency).

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS alternate_ticket_currency TEXT,
  ADD COLUMN IF NOT EXISTS alternate_ticket_price NUMERIC;

ALTER TABLE raffles DROP CONSTRAINT IF EXISTS raffles_alternate_ticket_currency_values;
ALTER TABLE raffles
  ADD CONSTRAINT raffles_alternate_ticket_currency_values
  CHECK (alternate_ticket_currency IS NULL OR alternate_ticket_currency IN ('SOL', 'BAMBOO'));

ALTER TABLE raffles DROP CONSTRAINT IF EXISTS raffles_alternate_ticket_pair_check;
ALTER TABLE raffles
  ADD CONSTRAINT raffles_alternate_ticket_pair_check
  CHECK (
    (alternate_ticket_currency IS NULL AND alternate_ticket_price IS NULL)
    OR (
      alternate_ticket_currency IS NOT NULL
      AND alternate_ticket_price IS NOT NULL
      AND alternate_ticket_price > 0
      AND alternate_ticket_currency <> currency
      AND currency IN ('SOL', 'BAMBOO')
      AND alternate_ticket_currency IN ('SOL', 'BAMBOO')
      AND (
        (currency = 'SOL' AND alternate_ticket_currency = 'BAMBOO')
        OR (currency = 'BAMBOO' AND alternate_ticket_currency = 'SOL')
      )
    )
  );

COMMENT ON COLUMN raffles.alternate_ticket_currency IS 'Optional second ticket payment asset (paired with currency: SOL+BAMBOO only).';
COMMENT ON COLUMN raffles.alternate_ticket_price IS 'Per-ticket price in alternate_ticket_currency when set.';
