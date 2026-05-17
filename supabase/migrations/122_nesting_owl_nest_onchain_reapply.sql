-- Re-apply on-chain NFT freeze lock for the canonical Owltopia perch (migration 112 may have been overwritten).
UPDATE public.staking_pools
SET
  adapter_mode = 'onchain_enabled',
  is_onchain_enabled = TRUE,
  requires_onchain_sync = FALSE,
  lock_enforcement_source = 'hybrid',
  updated_at = NOW()
WHERE slug = 'owl-nest-365';

-- Active nests opened before freeze metadata was recorded: mark ledger so UI/heal treat them as nested.
UPDATE public.staking_positions sp
SET
  external_reference = 'nft_freeze_confirmed:' || btrim(sp.asset_identifier),
  sync_status = COALESCE(NULLIF(btrim(sp.sync_status), ''), 'confirmed'),
  last_synced_at = COALESCE(sp.last_synced_at, NOW()),
  updated_at = NOW()
FROM public.staking_pools p
WHERE sp.pool_id = p.id
  AND p.slug = 'owl-nest-365'
  AND sp.status = 'active'
  AND sp.asset_identifier IS NOT NULL
  AND btrim(sp.asset_identifier) <> ''
  AND (
    sp.external_reference IS NULL
    OR btrim(sp.external_reference) = ''
  );
