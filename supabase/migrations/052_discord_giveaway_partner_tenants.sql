-- Paid partner integration: communities paste a channel webhook; we post giveaway updates (or they call our API with a secret).
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

CREATE TRIGGER update_discord_giveaway_partner_tenants_updated_at BEFORE UPDATE ON discord_giveaway_partner_tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE discord_giveaway_partner_tenants ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE discord_giveaway_partner_tenants IS 'External Discord servers (paid/trial): incoming webhook + API secret; service role only.';

ALTER TABLE nft_giveaways
  ADD COLUMN IF NOT EXISTS discord_partner_tenant_id UUID REFERENCES discord_giveaway_partner_tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_nft_giveaways_discord_partner ON nft_giveaways(discord_partner_tenant_id)
  WHERE discord_partner_tenant_id IS NOT NULL;
