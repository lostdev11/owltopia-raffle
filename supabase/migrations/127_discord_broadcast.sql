-- Discord broadcast templates and schedules (Owltopia bot posts to public/holder channels)
CREATE TABLE IF NOT EXISTS discord_broadcast_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by_wallet TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discord_broadcast_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES discord_broadcast_templates(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  post_to_public BOOLEAN NOT NULL DEFAULT true,
  post_to_holder BOOLEAN NOT NULL DEFAULT false,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('once', 'recurring')),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  once_at TIMESTAMPTZ,
  local_hour SMALLINT CHECK (local_hour IS NULL OR (local_hour >= 0 AND local_hour <= 23)),
  local_minute SMALLINT CHECK (local_minute IS NULL OR (local_minute >= 0 AND local_minute <= 59)),
  days_of_week SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7]::SMALLINT[],
  posts_per_day SMALLINT NOT NULL DEFAULT 1 CHECK (posts_per_day >= 1 AND posts_per_day <= 10),
  active BOOLEAN NOT NULL DEFAULT true,
  snooze_until TIMESTAMPTZ,
  campaign_start TIMESTAMPTZ,
  campaign_end TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_run_local_date DATE,
  posts_sent_on_last_run_date SMALLINT NOT NULL DEFAULT 0,
  once_completed BOOLEAN NOT NULL DEFAULT false,
  created_by_wallet TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT discord_broadcast_schedules_once_or_recurring CHECK (
    (schedule_type = 'once' AND once_at IS NOT NULL)
    OR (
      schedule_type = 'recurring'
      AND local_hour IS NOT NULL
      AND local_minute IS NOT NULL
    )
  ),
  CONSTRAINT discord_broadcast_schedules_channel CHECK (post_to_public OR post_to_holder)
);

CREATE TABLE IF NOT EXISTS discord_broadcast_send_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id UUID REFERENCES discord_broadcast_schedules(id) ON DELETE SET NULL,
  template_id UUID REFERENCES discord_broadcast_templates(id) ON DELETE SET NULL,
  body_snapshot TEXT NOT NULL,
  post_to_public BOOLEAN NOT NULL DEFAULT false,
  post_to_holder BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL CHECK (status IN ('sent', 'partial', 'failed')),
  error_message TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'cron' CHECK (triggered_by IN ('cron', 'manual')),
  created_by_wallet TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discord_broadcast_schedules_active
  ON discord_broadcast_schedules(active, schedule_type)
  WHERE active = true AND once_completed = false;

CREATE INDEX IF NOT EXISTS idx_discord_broadcast_send_log_created
  ON discord_broadcast_send_log(created_at DESC);

CREATE TRIGGER update_discord_broadcast_templates_updated_at
  BEFORE UPDATE ON discord_broadcast_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_discord_broadcast_schedules_updated_at
  BEFORE UPDATE ON discord_broadcast_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE discord_broadcast_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE discord_broadcast_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE discord_broadcast_send_log ENABLE ROW LEVEL SECURITY;

-- API-only: admin routes + cron use service role (see .cursor/rules/supabase-migrations.mdc)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discord_broadcast_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discord_broadcast_schedules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discord_broadcast_send_log TO service_role;
