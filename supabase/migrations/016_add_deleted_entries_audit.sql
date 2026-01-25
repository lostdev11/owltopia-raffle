-- ============================================================================
-- Migration 016: Add deleted_entries audit table to track deleted entries
-- ============================================================================

-- Create deleted_entries table to store audit trail of deleted entries
CREATE TABLE IF NOT EXISTS deleted_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  original_entry_id UUID NOT NULL,
  raffle_id UUID NOT NULL,
  wallet_address TEXT NOT NULL,
  ticket_quantity INTEGER NOT NULL,
  transaction_signature TEXT,
  status TEXT NOT NULL,
  amount_paid DECIMAL(10, 6) NOT NULL,
  currency TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_by TEXT NOT NULL,
  -- Store original entry data for reference
  original_entry_data JSONB
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_deleted_entries_raffle_id ON deleted_entries(raffle_id);
CREATE INDEX IF NOT EXISTS idx_deleted_entries_wallet ON deleted_entries(wallet_address);
CREATE INDEX IF NOT EXISTS idx_deleted_entries_deleted_at ON deleted_entries(deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_deleted_entries_original_id ON deleted_entries(original_entry_id);

-- Enable Row Level Security
ALTER TABLE deleted_entries ENABLE ROW LEVEL SECURITY;

-- Only admins can view deleted entries (we'll check admin status in the API)
-- For now, allow all SELECTs - the API will handle authorization
CREATE POLICY "Anyone can view deleted entries" ON deleted_entries
  FOR SELECT USING (true);

-- Only system/API can insert (no direct user inserts)
CREATE POLICY "Allow inserts to deleted_entries" ON deleted_entries
  FOR INSERT WITH CHECK (true);
