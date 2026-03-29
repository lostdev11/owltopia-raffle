-- Track how many times a raffle was extended because min_tickets was not met at end.
-- After 2 extensions, the next failure sets failed_refund_available and (for NFT) auto-returns prize to creator.

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS time_extension_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN raffles.time_extension_count IS 'Number of min-threshold deadline extensions; terminal failure after 2.';

-- Raffles already extended once under the old single-extension rule: give them one more extension before terminal.
UPDATE raffles r
SET time_extension_count = 1
WHERE r.original_end_time IS NOT NULL
  AND r.end_time IS NOT NULL
  AND r.end_time > r.original_end_time + interval '2 seconds'
  AND COALESCE(r.time_extension_count, 0) = 0;
