-- Opt-in @everyone ping for Discord broadcast templates (admin-selected only).
ALTER TABLE discord_broadcast_templates
  ADD COLUMN IF NOT EXISTS mention_everyone BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN discord_broadcast_templates.mention_everyone IS
  'When true, scheduled/manual posts prepend @everyone and set allowed_mentions for Discord.';
