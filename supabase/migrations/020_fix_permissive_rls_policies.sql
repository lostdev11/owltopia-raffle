-- ============================================================================
-- Migration 020: Fix permissive RLS policies (Supabase linter 0024)
-- ============================================================================
-- Removes INSERT/UPDATE/DELETE policies that use USING (true) or WITH CHECK (true).
-- Write access must go through the API using the service_role key (bypasses RLS).
-- See: https://supabase.com/docs/guides/database/database-linter?lint=0024_permissive_rls_policy
--
-- After this migration:
-- - Anonymous (anon) clients cannot insert/update/delete on these tables.
-- - API routes must use SUPABASE_SERVICE_ROLE_KEY for all write operations.

-- deleted_entries: drop permissive INSERT policy
DROP POLICY IF EXISTS "Allow inserts to deleted_entries" ON public.deleted_entries;

-- entries: drop permissive INSERT, UPDATE, DELETE policies
DROP POLICY IF EXISTS "Users can insert their own entries" ON public.entries;
DROP POLICY IF EXISTS "Allow updates to entries" ON public.entries;
DROP POLICY IF EXISTS "Allow deletes to entries" ON public.entries;

-- raffles: drop permissive INSERT, UPDATE, DELETE policies
DROP POLICY IF EXISTS "Allow inserts to raffles" ON public.raffles;
DROP POLICY IF EXISTS "Allow updates to raffles" ON public.raffles;
DROP POLICY IF EXISTS "Allow deletes to raffles" ON public.raffles;
