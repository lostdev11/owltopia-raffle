-- Audit log when a full admin permanently deletes a raffle (hard delete). Creator soft-deletes are not recorded here.

CREATE TABLE IF NOT EXISTS raffle_admin_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raffle_id UUID NOT NULL,
  admin_wallet TEXT NOT NULL,
  delete_reason TEXT NOT NULL CHECK (char_length(trim(delete_reason)) >= 10),
  raffle_slug TEXT,
  raffle_title TEXT,
  creator_wallet TEXT,
  nft_mint_address TEXT,
  prize_type TEXT,
  raffle_status TEXT,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raffle_admin_deletions_raffle_id ON raffle_admin_deletions(raffle_id);
CREATE INDEX IF NOT EXISTS idx_raffle_admin_deletions_deleted_at ON raffle_admin_deletions(deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_raffle_admin_deletions_admin_wallet ON raffle_admin_deletions(admin_wallet);

COMMENT ON TABLE raffle_admin_deletions IS 'Full-admin permanent raffle deletes; reason is required in the API.';

-- RLS on with no policies: anon/authenticated cannot read or write via the public API.
-- Server-side inserts use the service role key, which bypasses RLS.
ALTER TABLE raffle_admin_deletions ENABLE ROW LEVEL SECURITY;
