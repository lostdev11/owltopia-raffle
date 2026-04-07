-- Optional Discord account link (OAuth identify) for wallet profiles — used to @mention winners in server webhooks.
ALTER TABLE wallet_profiles
  ADD COLUMN IF NOT EXISTS discord_user_id TEXT,
  ADD COLUMN IF NOT EXISTS discord_username TEXT,
  ADD COLUMN IF NOT EXISTS discord_linked_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_profiles_discord_user_id_unique
  ON wallet_profiles(discord_user_id)
  WHERE discord_user_id IS NOT NULL;
