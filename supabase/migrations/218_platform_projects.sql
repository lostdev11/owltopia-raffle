-- Platform project index: snapshot NFT collections that have raffled here.
-- CRM notes/outreach are admin-only (API + service_role). Browse typeahead uses
-- Next.js GET /api/projects/suggest (service role, public columns only).
-- Indexing a collection does not grant partner fees or spotlight.

ALTER TABLE public.raffles
  ADD COLUMN IF NOT EXISTS nft_collection_mint text;

CREATE INDEX IF NOT EXISTS idx_raffles_nft_collection_mint
  ON public.raffles (nft_collection_mint)
  WHERE nft_collection_mint IS NOT NULL;

COMMENT ON COLUMN public.raffles.nft_collection_mint IS
  'On-chain collection mint (DAS grouping) for the prize NFT. Browse filter identity (?collection=). Null for 1/1s with no collection grouping.';

-- Recreate raffles_list so SELECT * picks up nft_collection_mint (Postgres expands * at CREATE VIEW time).
DROP VIEW IF EXISTS public.raffles_list CASCADE;

CREATE VIEW public.raffles_list AS
SELECT *
FROM public.raffles;

ALTER VIEW public.raffles_list SET (security_invoker = on);

GRANT SELECT ON public.raffles_list TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.platform_projects (
  collection_mint text PRIMARY KEY,
  slug text NOT NULL,
  display_name text NOT NULL,
  image_url text,
  twitter_handle text,
  raffle_count integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_host_wallet text,
  outreach_status text NOT NULL DEFAULT 'none',
  notes text,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_projects_outreach_status_check
    CHECK (outreach_status IN ('none', 'watchlist', 'contacted', 'skip')),
  CONSTRAINT platform_projects_raffle_count_check
    CHECK (raffle_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_projects_slug_uidx
  ON public.platform_projects (slug);

CREATE INDEX IF NOT EXISTS platform_projects_last_seen_idx
  ON public.platform_projects (last_seen_at DESC);

CREATE INDEX IF NOT EXISTS platform_projects_display_name_idx
  ON public.platform_projects (lower(display_name));

DROP TRIGGER IF EXISTS update_platform_projects_updated_at ON public.platform_projects;
CREATE TRIGGER update_platform_projects_updated_at
  BEFORE UPDATE ON public.platform_projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.platform_projects ENABLE ROW LEVEL SECURITY;

-- API + service role only (no anon/authenticated table grant — CRM columns stay private).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_projects TO service_role;

CREATE OR REPLACE VIEW public.platform_projects_public
WITH (security_invoker = true) AS
SELECT
  collection_mint,
  slug,
  display_name,
  image_url,
  twitter_handle,
  raffle_count,
  first_seen_at,
  last_seen_at
FROM public.platform_projects;

GRANT SELECT ON public.platform_projects_public TO service_role;

COMMENT ON TABLE public.platform_projects IS
  'NFT collections seen on the platform (raffle prize grouping). Usage snapshot + admin outreach CRM — not a partner fee allowlist. API + service role only.';

COMMENT ON VIEW public.platform_projects_public IS
  'Public catalog columns for project typeahead. Service role only; Next.js strips CRM fields. security_invoker.';
