-- Store partner logos on allowlisted creators; bookkeep application approval → creator provisioning.
-- Public read path: active partner_community_creators (RLS + anon/authenticated SELECT).
-- Applications remain API + service role only.

ALTER TABLE public.partner_community_creators
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN public.partner_community_creators.logo_url IS
  'Public HTTPS URL of the partner community logo (from approved partner_program_applications.logo_url or admin set). Used in Partner Spotlight.';

ALTER TABLE public.partner_program_applications
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_creator_wallet TEXT;

COMMENT ON COLUMN public.partner_program_applications.approved_at IS
  'When an admin approved this application and provisioned partner_community_creators.';
COMMENT ON COLUMN public.partner_program_applications.approved_creator_wallet IS
  'Wallet written to partner_community_creators on approve (normalized).';

-- Ensure Data API grants exist (table predates May 2026 auto-expose rules).
GRANT SELECT ON public.partner_community_creators TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_community_creators TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_program_applications TO service_role;
