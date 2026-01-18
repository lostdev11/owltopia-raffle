-- Add min_tickets field to raffles table
-- This allows admins to set a minimum number of tickets that must be sold before the raffle can be drawn
-- NULL means no minimum (raffle can be drawn immediately when it ends)

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS min_tickets INTEGER;

-- Add a check constraint to ensure min_tickets is positive if set
ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_min_tickets_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_min_tickets_check 
  CHECK (min_tickets IS NULL OR min_tickets > 0);

-- Add status field to track raffle state
-- Possible values: NULL/'active' (normal), 'pending_min_not_met' (ended but minimum not met), 'completed' (has winner)
ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS status TEXT;

-- Add CHECK constraint for status enum
ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_status_enum_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_status_enum_check 
  CHECK (status IS NULL OR status IN ('pending_min_not_met', 'completed'));

-- Create index for status lookups
CREATE INDEX IF NOT EXISTS idx_raffles_status ON raffles(status) 
WHERE status IS NOT NULL;

-- Create index for min_tickets lookups
CREATE INDEX IF NOT EXISTS idx_raffles_min_tickets ON raffles(min_tickets) 
WHERE min_tickets IS NOT NULL;
