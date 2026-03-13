-- Wallet display names: holders can set a name that appears in participant lists instead of their address.
CREATE TABLE IF NOT EXISTS wallet_profiles (
  wallet_address TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_profiles_wallet ON wallet_profiles(wallet_address);

-- Public read so participant lists can show names; writes go through API with session verification (service role bypasses RLS).
ALTER TABLE wallet_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view wallet profiles" ON wallet_profiles
  FOR SELECT USING (true);
