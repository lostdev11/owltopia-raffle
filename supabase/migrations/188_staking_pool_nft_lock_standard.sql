-- Per-perch NFT lock mechanism for multi-standard partner staking.
-- auto = detect via Helius DAS per asset; mpl_core = Metaplex Core FreezeDelegate;
-- spl_token = legacy SPL token-account freeze by nesting authority; database_only = ledger-only preview.

ALTER TABLE public.staking_pools
  ADD COLUMN IF NOT EXISTS nft_lock_standard text NOT NULL DEFAULT 'auto'
    CHECK (nft_lock_standard IN (
      'auto',
      'mpl_core_freeze_delegate',
      'spl_token_account_freeze',
      'database_only'
    ));

COMMENT ON COLUMN public.staking_pools.nft_lock_standard IS
  'NFT nest lock: auto (Helius detect), mpl_core_freeze_delegate, spl_token_account_freeze, or database_only.';

-- Owltopia Coin perch — MPL Core (existing production path).
UPDATE public.staking_pools
SET nft_lock_standard = 'mpl_core_freeze_delegate', updated_at = NOW()
WHERE slug IN ('owl-nest-365', 'owl-council-governance')
  AND asset_type = 'nft';

-- Gen 2 Candy Machine legacy NFTs — SPL token-account freeze after collection thaw.
UPDATE public.staking_pools
SET nft_lock_standard = 'spl_token_account_freeze', updated_at = NOW()
WHERE slug IN ('gen2-owl-90d', 'gen2-owl-180d');

-- Gen 1 — detect per asset (legacy TM or MPL Core if migrated).
UPDATE public.staking_pools
SET nft_lock_standard = 'auto', updated_at = NOW()
WHERE slug IN ('gen1-owl-90d', 'gen1-owl-180d');
