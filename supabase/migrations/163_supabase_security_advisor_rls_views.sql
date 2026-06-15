-- Supabase Database Linter: enable RLS on internal/service-only tables; use SECURITY INVOKER on views.
-- Tables: accessed only via service_role or SECURITY DEFINER RPCs in app code — anon/authenticated must not SELECT/WRITE directly.
-- Views: SECURITY INVOKER so querying user's RLS applies to underlying tables (matches migration 023 pattern).

ALTER TABLE IF EXISTS public.verified_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.discord_partner_payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.community_giveaway_owl_boosts ENABLE ROW LEVEL SECURITY;

-- Views (PostgreSQL 15+): respect invoker permissions instead of view owner's (fixes "Security Definer View" advisor).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'referral_leaderboard_v1'
  ) THEN
    EXECUTE 'ALTER VIEW public.referral_leaderboard_v1 SET (security_invoker = on)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'gen2_presale_available_balances'
  ) THEN
    EXECUTE 'ALTER VIEW public.gen2_presale_available_balances SET (security_invoker = on)';
  END IF;
END
$$;
