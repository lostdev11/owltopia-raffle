-- Single-row toggle: Gen2 presale purchases allowed only when is_live = true (admin-controlled).

CREATE TABLE IF NOT EXISTS gen2_presale_settings (
  id text PRIMARY KEY DEFAULT 'default',
  is_live boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_wallet text
);

INSERT INTO gen2_presale_settings (id, is_live, updated_at)
VALUES ('default', false, now())
ON CONFLICT (id) DO NOTHING;

ALTER TABLE gen2_presale_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view gen2 presale settings" ON gen2_presale_settings;
CREATE POLICY "Anyone can view gen2 presale settings"
  ON gen2_presale_settings
  FOR SELECT
  USING (true);

COMMENT ON TABLE gen2_presale_settings IS 'Single row id=default. Public read; writes via service role admin API only.';
