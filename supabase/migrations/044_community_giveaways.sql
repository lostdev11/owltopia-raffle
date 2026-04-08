-- Community pool giveaways (platform-held prize). Safe to run if objects already exist (IF NOT EXISTS / policy guard).
-- Apply via Supabase Dashboard SQL Editor when setting up or syncing schema.

CREATE TABLE IF NOT EXISTS community_giveaways (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  access_gate TEXT NOT NULL DEFAULT 'open' CHECK (access_gate IN ('open', 'holder_only')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  prize_deposited_at TIMESTAMPTZ,
  nft_mint_address TEXT,
  nft_token_id TEXT,
  nft_metadata_uri TEXT,
  prize_standard TEXT,
  prize_deposit_tx TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_wallet TEXT
);

CREATE INDEX IF NOT EXISTS idx_community_giveaways_status ON community_giveaways (status);
CREATE INDEX IF NOT EXISTS idx_community_giveaways_starts_at ON community_giveaways (starts_at DESC);

ALTER TABLE community_giveaways ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'community_giveaways'
      AND policyname = 'community_giveaways_public_select_open'
  ) THEN
    CREATE POLICY community_giveaways_public_select_open ON community_giveaways
      FOR SELECT
      USING (status = 'open' AND prize_deposited_at IS NOT NULL);
  END IF;
END $$;
