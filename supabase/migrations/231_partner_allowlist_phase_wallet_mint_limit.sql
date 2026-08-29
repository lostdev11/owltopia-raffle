-- Document per-phase wallet_mint_limit on partner_allowlist_phases jsonb.
-- No schema change: optional wallet_mint_limit is stored inside the existing jsonb array.

COMMENT ON COLUMN public.owl_center_launches.partner_allowlist_phases IS
  'Ordered partner allowlist phases [{key,label,starts_at,supply,price_usdc,wallet_mint_limit?}] before PUBLIC. wallet_mint_limit null/omit inherits launch.wallet_mint_limit. Empty = legacy single WL via creator_wl_enabled / phase_schedule.WHITELIST.';
