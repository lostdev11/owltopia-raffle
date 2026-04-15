-- Per-wallet engagement milestones: one row per (wallet, milestone_key), idempotent XP awards.
-- Writes go through the API (service role); RLS enabled with no policies for anon/authenticated.

CREATE TABLE IF NOT EXISTS wallet_milestones (
  wallet_address TEXT NOT NULL,
  milestone_key TEXT NOT NULL,
  xp INTEGER NOT NULL CHECK (xp > 0 AND xp <= 10000),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wallet_address, milestone_key),
  CONSTRAINT wallet_milestones_key_len CHECK (char_length(milestone_key) <= 64)
);

CREATE INDEX IF NOT EXISTS idx_wallet_milestones_wallet ON wallet_milestones(wallet_address);

ALTER TABLE wallet_milestones ENABLE ROW LEVEL SECURITY;
