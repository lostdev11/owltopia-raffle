-- ============================================================================
-- Migration 019: Fix function search_path (Supabase linter 0011)
-- ============================================================================
-- Sets an explicit search_path on functions to prevent search_path hijacking.
-- See: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

-- 1) update_updated_at_column: recreate with explicit search_path
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 2) set_creator_payout_wallet: set search_path if the function exists
--    (may have been created in dashboard or another migration not in this repo)
DO $$
DECLARE
  fn_oid oid;
  fn_args text;
BEGIN
  SELECT p.oid, pg_get_function_identity_arguments(p.oid)
  INTO fn_oid, fn_args
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'set_creator_payout_wallet'
  LIMIT 1;

  IF fn_oid IS NOT NULL THEN
    EXECUTE format(
      'ALTER FUNCTION public.set_creator_payout_wallet(%s) SET search_path = public',
      fn_args
    );
  END IF;
END;
$$;
