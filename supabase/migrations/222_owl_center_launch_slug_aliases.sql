-- Previous mint/share slugs for Owl Center launches.
-- When a `sub-<uuid>` submission slug is promoted to the collection name,
-- the old path stays resolvable so already-shared /m/ links keep working.

CREATE TABLE IF NOT EXISTS public.owl_center_launch_slug_aliases (
  slug text PRIMARY KEY,
  launch_id uuid NOT NULL REFERENCES public.owl_center_launches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owl_center_launch_slug_aliases_slug_format
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$')
);

CREATE INDEX IF NOT EXISTS idx_owl_center_launch_slug_aliases_launch_id
  ON public.owl_center_launch_slug_aliases (launch_id);

COMMENT ON TABLE public.owl_center_launch_slug_aliases IS
  'Former owl_center_launches.slug values kept so /m/<old-slug> and collection URLs still resolve.';

ALTER TABLE public.owl_center_launch_slug_aliases ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owl_center_launch_slug_aliases TO service_role;
