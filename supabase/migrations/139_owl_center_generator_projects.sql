-- Wallet-scoped Owl Center trait generator projects (cloud save).

CREATE TABLE IF NOT EXISTS public.owl_center_generator_projects (
  wallet text PRIMARY KEY,
  project_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'My Collection',
  project_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owl_center_generator_projects_updated
  ON public.owl_center_generator_projects (updated_at DESC);

COMMENT ON TABLE public.owl_center_generator_projects IS
  'One generator project per wallet — layers, rules, and metadata for Owl Center trait generator.';

ALTER TABLE public.owl_center_generator_projects ENABLE ROW LEVEL SECURITY;
