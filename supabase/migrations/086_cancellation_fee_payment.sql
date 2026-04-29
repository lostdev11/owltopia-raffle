-- Record on-chain 0.1 SOL cancellation fee when the raffle has started (start_time in the past).

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS cancellation_fee_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_fee_payment_tx TEXT;

COMMENT ON COLUMN raffles.cancellation_fee_paid_at IS 'When the creator paid the post-start cancellation fee to treasury (on-chain), required before admin can complete cancellation and before claiming NFT back.';
COMMENT ON COLUMN raffles.cancellation_fee_payment_tx IS 'Solana tx signature of the cancellation fee SOL transfer.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_raffles_cancellation_fee_payment_tx
  ON raffles(cancellation_fee_payment_tx)
  WHERE cancellation_fee_payment_tx IS NOT NULL;
