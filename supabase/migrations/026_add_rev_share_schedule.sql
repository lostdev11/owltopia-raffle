-- Single-row config for "next rev share" (founder-editable date and amounts)
CREATE TABLE IF NOT EXISTS rev_share_schedule (
  id TEXT PRIMARY KEY DEFAULT 'default',
  next_date TEXT,
  total_sol NUMERIC(20, 4),
  total_usdc NUMERIC(20, 2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure the single row exists
INSERT INTO rev_share_schedule (id, next_date, total_sol, total_usdc, updated_at)
VALUES ('default', NULL, NULL, NULL, NOW())
ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER update_rev_share_schedule_updated_at BEFORE UPDATE ON rev_share_schedule
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE rev_share_schedule ENABLE ROW LEVEL SECURITY;

-- Public can read (for homepage)
CREATE POLICY "Anyone can view rev share schedule" ON rev_share_schedule
  FOR SELECT USING (true);

-- Writes via service role only (admin API)
