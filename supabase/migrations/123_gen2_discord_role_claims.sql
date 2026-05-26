-- Gen2 presale Discord role claims + admin-managed whitelist wallets.
-- API-only tables (service_role via Next.js); no anon/authenticated policies.

CREATE TABLE IF NOT EXISTS gen2_whitelist_wallets (
  wallet_address text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_wallet text,
  note text
);

CREATE INDEX IF NOT EXISTS idx_gen2_whitelist_wallets_created_at
  ON gen2_whitelist_wallets (created_at DESC);

COMMENT ON TABLE gen2_whitelist_wallets IS 'Wallets eligible for Gen2 whitelist Discord role; managed by presale admins via API.';

CREATE TABLE IF NOT EXISTS discord_role_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL,
  discord_id text NOT NULL,
  role_type text NOT NULL CHECK (role_type IN ('gen2_presale', 'gen2_whitelist')),
  status text NOT NULL CHECK (status IN ('pending', 'granted', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_discord_role_claims_wallet_role_granted
  ON discord_role_claims (wallet_address, role_type)
  WHERE status = 'granted';

CREATE INDEX IF NOT EXISTS idx_discord_role_claims_created_at
  ON discord_role_claims (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discord_role_claims_wallet
  ON discord_role_claims (wallet_address);

CREATE INDEX IF NOT EXISTS idx_discord_role_claims_discord_id
  ON discord_role_claims (discord_id);

COMMENT ON TABLE discord_role_claims IS 'Audit log of Discord guild role grants for Gen2 presale/whitelist; written by /api/discord/claim-role.';

ALTER TABLE gen2_whitelist_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE discord_role_claims ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gen2_whitelist_wallets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discord_role_claims TO service_role;
