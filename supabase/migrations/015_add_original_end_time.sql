-- Add original_end_time field to raffles table
-- This tracks the initial end_time before any extensions
-- Used to determine if 7 days have passed since the original end time
-- NULL means the raffle hasn't been extended yet (original_end_time = end_time)

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS original_end_time TIMESTAMPTZ;

-- Create index for original_end_time lookups
CREATE INDEX IF NOT EXISTS idx_raffles_original_end_time ON raffles(original_end_time) 
WHERE original_end_time IS NOT NULL;
