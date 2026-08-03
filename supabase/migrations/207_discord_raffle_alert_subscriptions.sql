-- Free platform raffle alerts: Discord servers that opt in get bot posts for new public live raffles.

CREATE TABLE IF NOT EXISTS discord_raffle_alert_subscriptions (
  discord_guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  configured_by_discord_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discord_raffle_alert_subs_enabled
  ON discord_raffle_alert_subscriptions (enabled)
  WHERE enabled = true;

COMMENT ON TABLE discord_raffle_alert_subscriptions IS
  'Guilds that opted into free /owltopia-alerts: bot posts new public live raffles to channel_id.';

ALTER TABLE discord_raffle_alert_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access discord_raffle_alert_subscriptions"
  ON discord_raffle_alert_subscriptions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Idempotent fan-out marker so create/publish/promote only announce once per raffle.
ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS discord_community_alert_posted_at TIMESTAMPTZ;

COMMENT ON COLUMN raffles.discord_community_alert_posted_at IS
  'When this public live raffle was fan-out posted to Discord raffle-alert subscribers; null = not yet.';
