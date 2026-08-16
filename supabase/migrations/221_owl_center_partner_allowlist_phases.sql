-- Multi allowlist phases for partner / public_simple collections (Team / OG / WL / WL2 / …).
-- Extends migration 220 (owl_center_launch_wl_wallets).

ALTER TABLE public.owl_center_launches
  ADD COLUMN IF NOT EXISTS partner_allowlist_phases jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.owl_center_launches.partner_allowlist_phases IS
  'Ordered partner allowlist phases [{key,label,starts_at,supply,price_usdc}] before PUBLIC. Empty = legacy single WL via creator_wl_enabled / phase_schedule.WHITELIST.';

ALTER TABLE public.owl_center_launch_wl_wallets
  ADD COLUMN IF NOT EXISTS phase_key text NOT NULL DEFAULT 'wl';

ALTER TABLE public.owl_center_launch_wl_wallets
  DROP CONSTRAINT IF EXISTS owl_center_launch_wl_wallets_pkey;

ALTER TABLE public.owl_center_launch_wl_wallets
  ADD PRIMARY KEY (launch_id, phase_key, wallet);

CREATE INDEX IF NOT EXISTS idx_owl_center_launch_wl_wallets_launch_phase
  ON public.owl_center_launch_wl_wallets (launch_id, phase_key, updated_at DESC);
