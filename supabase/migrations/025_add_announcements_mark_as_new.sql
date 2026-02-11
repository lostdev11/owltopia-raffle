-- Add mark_as_new so admins can show a notification badge when there's a new announcement
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS mark_as_new BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN announcements.mark_as_new IS 'When true, show a notification icon on the Announcements tab to draw attention.';
