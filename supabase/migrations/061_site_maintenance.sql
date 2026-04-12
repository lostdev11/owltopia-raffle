-- Scheduled public maintenance window (controlled from Owl Vision /admin).
-- When now is within [starts_at, ends_at), the site shows a top-of-page maintenance banner.

CREATE TABLE IF NOT EXISTS site_maintenance (
  id TEXT PRIMARY KEY DEFAULT 'default',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_wallet TEXT
);

INSERT INTO site_maintenance (id, starts_at, ends_at, message, updated_at, updated_by_wallet)
VALUES ('default', NULL, NULL, NULL, NOW(), NULL)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS update_site_maintenance_updated_at ON site_maintenance;
CREATE TRIGGER update_site_maintenance_updated_at
  BEFORE UPDATE ON site_maintenance
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE site_maintenance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view site maintenance" ON site_maintenance;
CREATE POLICY "Anyone can view site maintenance"
  ON site_maintenance
  FOR SELECT
  USING (true);

COMMENT ON TABLE site_maintenance IS 'Single-row (id=default). Public read for banner; writes via service role admin API only.';
