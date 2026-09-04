-- Launch-scoped whitelist wallets for partner / public_simple collections.
-- Separate from Gen2's global owl_center_wl_allocations (wallet PRIMARY KEY).

CREATE TABLE IF NOT EXISTS public.owl_center_launch_wl_wallets (
  launch_id uuid NOT NULL REFERENCES public.owl_center_launches(id) ON DELETE CASCADE,
  wallet text NOT NULL,
  allowed_mints int NOT NULL DEFAULT 1,
  used_mints int NOT NULL DEFAULT 0,
  note text,
  created_by_wallet text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (launch_id, wallet),
  CONSTRAINT owl_center_launch_wl_allowed_nonneg CHECK (allowed_mints >= 0),
  CONSTRAINT owl_center_launch_wl_used_nonneg CHECK (used_mints >= 0),
  CONSTRAINT owl_center_launch_wl_used_cap CHECK (used_mints <= allowed_mints)
);

CREATE INDEX IF NOT EXISTS idx_owl_center_launch_wl_wallets_launch
  ON public.owl_center_launch_wl_wallets (launch_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_owl_center_launch_wl_wallets_wallet
  ON public.owl_center_launch_wl_wallets (wallet);

COMMENT ON TABLE public.owl_center_launch_wl_wallets IS
  'Per-launch whitelist wallets for partner collections (creator Manage collection). Soft-gated in mint eligibility during WL window before public open.';

ALTER TABLE public.owl_center_launch_wl_wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owl_center_launch_wl_wallets_deny_all ON public.owl_center_launch_wl_wallets;
CREATE POLICY owl_center_launch_wl_wallets_deny_all
  ON public.owl_center_launch_wl_wallets
  FOR ALL
  USING (false)
  WITH CHECK (false);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owl_center_launch_wl_wallets TO service_role;
