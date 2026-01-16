-- Fix RLS policy on admins table to allow SELECT for admin checks
-- Drop the old restrictive policy
DROP POLICY IF EXISTS "No public access to admins" ON admins;

-- Drop existing policies if they exist (to allow re-running this migration)
DROP POLICY IF EXISTS "Allow admin status checks" ON admins;
DROP POLICY IF EXISTS "No public write access to admins" ON admins;
DROP POLICY IF EXISTS "No public update access to admins" ON admins;
DROP POLICY IF EXISTS "No public delete access to admins" ON admins;

-- Allow SELECT for admin status checks (needed for API to verify admin status)
CREATE POLICY "Allow admin status checks" ON admins
  FOR SELECT USING (true);

-- Block INSERT/UPDATE/DELETE from client (must use service role)
CREATE POLICY "No public write access to admins" ON admins
  FOR INSERT WITH CHECK (false);

CREATE POLICY "No public update access to admins" ON admins
  FOR UPDATE USING (false);

CREATE POLICY "No public delete access to admins" ON admins
  FOR DELETE USING (false);
