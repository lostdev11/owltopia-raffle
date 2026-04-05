-- Screenshots for dev tasks (Supabase Storage + column on dev_tasks)

ALTER TABLE dev_tasks
  ADD COLUMN IF NOT EXISTS screenshot_paths TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN dev_tasks.screenshot_paths IS 'Storage object paths in bucket dev-task-screenshots (taskId/uuid.ext); public URLs derived at read time.';

-- Public bucket so <img src> works for admins viewing Owl Vision (same pattern as raffle-images)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dev-task-screenshots',
  'dev-task-screenshots',
  true,
  5242880,
  NULL
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit;

-- Anyone can read (bucket is public); uploads go through API + service role only
DROP POLICY IF EXISTS "Public read dev task screenshots" ON storage.objects;
CREATE POLICY "Public read dev task screenshots"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'dev-task-screenshots');
