-- Ensure entries are globally viewable
-- Drop any existing SELECT policies that might restrict viewing
DROP POLICY IF EXISTS "Users can view entries for raffles" ON entries;

-- Create a clear global SELECT policy for entries
-- This ensures all entries are visible to everyone (no filtering by user)
CREATE POLICY "Anyone can view all entries" ON entries
  FOR SELECT USING (true);
