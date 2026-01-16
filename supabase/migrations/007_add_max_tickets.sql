-- Add max_tickets field to raffles table
-- This allows admins to set a limit on the total number of tickets that can be purchased for a raffle
-- NULL means no limit (unlimited tickets)

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS max_tickets INTEGER;

-- Add a check constraint to ensure max_tickets is positive if set
ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_max_tickets_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_max_tickets_check 
  CHECK (max_tickets IS NULL OR max_tickets > 0);

-- Create index for max_tickets lookups (optional, but useful for filtering)
CREATE INDEX IF NOT EXISTS idx_raffles_max_tickets ON raffles(max_tickets) 
WHERE max_tickets IS NOT NULL;
