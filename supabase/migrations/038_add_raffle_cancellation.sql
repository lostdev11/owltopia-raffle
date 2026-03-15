-- Raffle cancellation: creator can request cancellation; admin accepts in Owl Vision.
-- Ticket buyers get refunds in all cases (treasury sends). Within 24h: no fee to host. After 24h: host is charged cancellation fee.

-- Allow 'cancelled' status
ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_status_enum_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_status_enum_check
  CHECK (status IS NULL OR status IN (
    'draft', 'live', 'ready_to_draw', 'completed', 'pending_min_not_met', 'cancelled'
  ));

-- Creator requested cancellation (pending admin approval)
ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ;

-- Set when admin accepts cancellation
ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_fee_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS cancellation_fee_currency TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_refund_policy TEXT;

COMMENT ON COLUMN raffles.cancellation_requested_at IS 'When the creator requested cancellation; admin can accept in Owl Vision.';
COMMENT ON COLUMN raffles.cancelled_at IS 'When admin accepted the cancellation.';
COMMENT ON COLUMN raffles.cancellation_fee_amount IS 'Fee charged on cancellation (when refund_policy is no_refund).';
COMMENT ON COLUMN raffles.cancellation_fee_currency IS 'Currency of cancellation fee (e.g. SOL, USDC).';
COMMENT ON COLUMN raffles.cancellation_refund_policy IS 'full_refund = within 24h (no host fee); no_refund = after 24h (host charged fee). Ticket buyers get refunds in both cases.';

-- Optional: index for admin list of pending cancellation requests
CREATE INDEX IF NOT EXISTS idx_raffles_cancellation_requested
  ON raffles(cancellation_requested_at)
  WHERE cancellation_requested_at IS NOT NULL;
