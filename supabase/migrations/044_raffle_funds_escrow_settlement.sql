-- Funds escrow: ticket proceeds separate from NFT prize escrow; claim-based settlement.

ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_status_enum_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_status_enum_check
  CHECK (status IS NULL OR status IN (
    'draft',
    'live',
    'ready_to_draw',
    'completed',
    'pending_min_not_met',
    'cancelled',
    'successful_pending_claims',
    'failed_refund_available'
  ));

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS ticket_payments_to_funds_escrow BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS nft_escrow_address_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS funds_escrow_address_snapshot TEXT;

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS creator_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS creator_claim_tx TEXT,
  ADD COLUMN IF NOT EXISTS creator_funds_claim_locked_at TIMESTAMPTZ;

UPDATE raffles r
SET ticket_payments_to_funds_escrow = false
WHERE EXISTS (
  SELECT 1 FROM entries e
  WHERE e.raffle_id = r.id AND e.status = 'confirmed'
);

ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_transaction_signature TEXT,
  ADD COLUMN IF NOT EXISTS refund_lock_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_entries_refund_pending
  ON entries (raffle_id)
  WHERE status = 'confirmed' AND refunded_at IS NULL;
