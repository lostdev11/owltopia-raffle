-- Dev tasks: internal queue for platform issues reported via Discord (Owl Vision admin only; service role API)
CREATE TABLE IF NOT EXISTS dev_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dev_tasks_status_created ON dev_tasks(status, created_at DESC);

CREATE TRIGGER update_dev_tasks_updated_at BEFORE UPDATE ON dev_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE dev_tasks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE dev_tasks IS 'Admin-only backlog from Discord/support; accessed via service role in /api/admin/dev-tasks';
