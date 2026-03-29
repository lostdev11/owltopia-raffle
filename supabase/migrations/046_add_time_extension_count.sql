-- Track how many times a raffle was extended because min_tickets was not met at end.
-- App policy: max 1 min-threshold extension (MAX_MIN_THRESHOLD_TIME_EXTENSIONS); next failure sets failed_refund_available and (for NFT) auto-returns prize to creator.

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS time_extension_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN raffles.time_extension_count IS 'Number of min-threshold deadline extensions; terminal failure after the configured max (1).';

-- Raffles already extended once before this column existed: backfill count so policy matches end_time vs original_end_time.
UPDATE raffles r
SET time_extension_count = 1
WHERE r.original_end_time IS NOT NULL
  AND r.end_time IS NOT NULL
  AND r.end_time > r.original_end_time + interval '2 seconds'
  AND COALESCE(r.time_extension_count, 0) = 0;
