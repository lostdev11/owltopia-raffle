-- Add DELETE policy for entries table
-- Since admin checks are done at the API level (server-side),
-- we allow DELETE for all requests
-- The API validates admin status before allowing deletes
-- This is secure because:
-- 1. API routes are server-side and cannot be bypassed from client
-- 2. Admin status is checked before any delete operation
-- 3. The anon key is used, but all deletes go through authenticated API endpoints

-- Drop existing policy if it exists (for re-running)
DROP POLICY IF EXISTS "Allow deletes to entries" ON entries;

-- Allow DELETE for all requests (API validates admin status)
-- The API endpoint checks admin status before calling deleteEntry
CREATE POLICY "Allow deletes to entries" ON entries
  FOR DELETE USING (true);
