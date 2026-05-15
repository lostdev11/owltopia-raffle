-- Show the OWL token governance perch alongside the canonical NFT nest (migration 104 only keeps owl-nest-365 active).
-- Mainnet OWL mint (same as NEXT_PUBLIC_OWL_MINT_ADDRESS on production). Env sync in ensure-council-governance-pool.ts can still override if needed.

UPDATE public.staking_pools
SET
  is_active = TRUE,
  display_order = 1,
  token_mint = 'JA2gZuhy83CD71xQNMJCMHvTvhxFnVFerw5dYiyFkAfM',
  stake_mint = 'JA2gZuhy83CD71xQNMJCMHvTvhxFnVFerw5dYiyFkAfM',
  updated_at = NOW()
WHERE slug = 'owl-council-governance';
