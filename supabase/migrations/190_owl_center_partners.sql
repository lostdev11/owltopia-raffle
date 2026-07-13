-- Owl Center launchpad partners: wallets approved to use the launch wizard and Owl Generator
-- (submit collections for review) without being Owl Vision admins.

CREATE TABLE IF NOT EXISTS public.owl_center_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet text NOT NULL UNIQUE,
  label text,
  notes text,
  status text NOT NULL DEFAULT 'approved',
  added_by_wallet text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owl_center_partners_status_check CHECK (status IN ('approved', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_owl_center_partners_status
  ON public.owl_center_partners (status, updated_at DESC);

COMMENT ON TABLE public.owl_center_partners IS
  'Approved launchpad partner wallets — may submit collections and use the Owl Generator. API + service_role only.';

ALTER TABLE public.owl_center_partners ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owl_center_partners TO service_role;
