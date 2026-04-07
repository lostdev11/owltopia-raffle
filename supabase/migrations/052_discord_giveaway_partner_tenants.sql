-- Paid partner integration: communities paste a channel webhook; we post giveaway updates (or they call our API with a secret).

-- Trigger helper (normally created in 001_initial_schema / 019; required if this migration runs alone)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS discord_giveaway_partner_tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  discord_guild_id TEXT,
  webhook_url TEXT NOT NULL,
  api_secret_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'suspended' CHECK (status IN ('active', 'trial', 'suspended')),
  active_until TIMESTAMPTZ,
  contact_note TEXT,
  created_by_wallet TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discord_giveaway_partners_status ON discord_giveaway_partner_tenants(status);

DROP TRIGGER IF EXISTS update_discord_giveaway_partner_tenants_updated_at ON discord_giveaway_partner_tenants;
CREATE TRIGGER update_discord_giveaway_partner_tenants_updated_at BEFORE UPDATE ON discord_giveaway_partner_tenants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE discord_giveaway_partner_tenants ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE discord_giveaway_partner_tenants IS 'External Discord servers (paid/trial): incoming webhook + API secret; service role only.';

-- nft_giveaways comes from 051; if this runs in one transaction and the ALTER fails, Postgres rolls back the partner table too.
-- Guard so partner tenants always land even when nft_giveaways is missing (run 051 later, then re-run this block if needed).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'nft_giveaways'
  ) THEN
    ALTER TABLE nft_giveaways
      ADD COLUMN IF NOT EXISTS discord_partner_tenant_id UUID REFERENCES discord_giveaway_partner_tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_nft_giveaways_discord_partner ON nft_giveaways(discord_partner_tenant_id)
      WHERE discord_partner_tenant_id IS NOT NULL;
  END IF;
END $$;
