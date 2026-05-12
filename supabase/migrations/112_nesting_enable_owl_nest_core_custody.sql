-- Owl Nesting: make the canonical 365-day NFT perch custody-backed.
-- New stakes require a wallet-signed Metaplex Core transfer into NESTING_ESCROW_WALLET_ADDRESS.

UPDATE public.staking_pools
SET
  adapter_mode = 'onchain_enabled',
  is_onchain_enabled = TRUE,
  requires_onchain_sync = TRUE,
  lock_enforcement_source = 'hybrid',
  updated_at = NOW()
WHERE slug = 'owl-nest-365';

CREATE UNIQUE INDEX IF NOT EXISTS staking_positions_open_asset_unique
  ON public.staking_positions (pool_id, asset_identifier)
  WHERE asset_identifier IS NOT NULL
    AND status IN ('active', 'pending');

COMMENT ON INDEX public.staking_positions_open_asset_unique IS
  'An NFT asset may have only one open Owl Nesting position per pool, including pending custody transfer rows.';
