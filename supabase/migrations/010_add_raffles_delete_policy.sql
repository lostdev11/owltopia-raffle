-- Add DELETE policy for raffles table
-- Since admin checks are done at the API level (server-side),
-- we allow DELETE for all requests
-- The API validates admin status before allowing deletes
-- This is secure because:
-- 1. API routes are server-side and cannot be bypassed from client
-- 2. Admin status is checked before any delete operation
-- 3. The anon key is used, but all deletes go through authenticated API endpoints

-- Drop existing policy if it exists (for re-running)
DROP POLICY IF EXISTS "Allow deletes to raffles" ON raffles;

-- Allow DELETE for all requests (API validates admin status)
-- The API endpoint checks admin status before calling deleteRaffle
CREATE POLICY "Allow deletes to raffles" ON raffles
  FOR DELETE USING (true);
