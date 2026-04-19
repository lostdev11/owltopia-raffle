-- Cross-request cache for Owltopia NFT holder checks (Helius DAS).
-- Rows are upserted when verification completes; reads accept data up to 7 days old (see lib/db/owltopia-holder-snapshot.ts).

CREATE TABLE IF NOT EXISTS owltopia_holder_snapshots (
  wallet_address TEXT PRIMARY KEY,
  is_holder BOOLEAN NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT owltopia_holder_snapshots_wallet_len CHECK (char_length(wallet_address) <= 64)
);

CREATE INDEX IF NOT EXISTS idx_owltopia_holder_snapshots_checked_at ON owltopia_holder_snapshots (checked_at);

ALTER TABLE owltopia_holder_snapshots ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE owltopia_holder_snapshots IS 'Optional 7-day holder snapshot to reduce Helius DAS usage; written by server API only (service role).';
