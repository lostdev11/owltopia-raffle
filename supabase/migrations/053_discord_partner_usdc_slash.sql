-- USDC payment intents for Discord slash / subscribe → verify flow
CREATE TABLE IF NOT EXISTS discord_partner_payment_intents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference_code TEXT NOT NULL UNIQUE,
  discord_guild_id TEXT NOT NULL,
  discord_guild_name TEXT,
  amount_usdc NUMERIC(14, 6) NOT NULL,
  memo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'expired', 'superseded')),
  confirmed_signature TEXT UNIQUE,
  partner_tenant_id UUID REFERENCES discord_giveaway_partner_tenants(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discord_partner_intents_guild ON discord_partner_payment_intents(discord_guild_id);
CREATE INDEX IF NOT EXISTS idx_discord_partner_intents_pending ON discord_partner_payment_intents(discord_guild_id)
  WHERE status = 'pending';

ALTER TABLE discord_giveaway_partner_tenants ALTER COLUMN webhook_url DROP NOT NULL;

COMMENT ON TABLE discord_partner_payment_intents IS 'Discord slash USDC subscribe: memo OWLGW:<ref> on-chain; service role only.';
