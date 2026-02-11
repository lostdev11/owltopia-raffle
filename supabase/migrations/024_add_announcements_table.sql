-- Announcements: admin-managed messages shown on the landing (hero) and/or raffles page
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  body TEXT,
  show_on_hero BOOLEAN NOT NULL DEFAULT true,
  show_on_raffles BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcements_active_placement ON announcements(active, show_on_hero, show_on_raffles);
CREATE INDEX IF NOT EXISTS idx_announcements_sort ON announcements(sort_order, created_at);

-- Trigger for updated_at
CREATE TRIGGER update_announcements_updated_at BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: public read active announcements; writes require service role (admin API uses service role)
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active announcements" ON announcements
  FOR SELECT USING (active = true);
