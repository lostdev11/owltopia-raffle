-- Fix: public.raffles_list was created with SECURITY DEFINER, so it runs with the
-- view owner's privileges and bypasses RLS. Switch to SECURITY INVOKER so the view
-- respects the querying user's permissions and RLS (PostgreSQL 15+).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'raffles_list'
  ) THEN
    EXECUTE 'ALTER VIEW public.raffles_list SET (security_invoker = on)';
  END IF;
END
$$;
