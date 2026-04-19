-- One non-terminal NFT prize raffle per asset id site-wide (matches app-layer duplicate check after normalization).
-- "Asset id" is COALESCE(mint, token_id) so SPL mint-only and token-id-only rows collide correctly.

-- Pre-step: existing duplicate listings (same asset key, multiple non-terminal rows) must be resolved or CREATE UNIQUE INDEX fails.
-- Keep the row with the most confirmed ticket entries; tie-break by prize deposited, then oldest created_at.
UPDATE raffles r
SET
  status = 'cancelled',
  cancelled_at = COALESCE(r.cancelled_at, now()),
  updated_at = now(),
  is_active = false
FROM (
  SELECT
    c.id,
    ROW_NUMBER() OVER (
      PARTITION BY c.asset_key
      ORDER BY
        (SELECT COUNT(*)::bigint FROM entries e WHERE e.raffle_id = c.id AND e.status = 'confirmed') DESC,
        (c.prize_deposited_at IS NOT NULL) DESC,
        c.created_at ASC NULLS LAST,
        c.id ASC
    ) AS rn
  FROM (
    SELECT
      r2.id,
      COALESCE(NULLIF(TRIM(r2.nft_mint_address), ''), NULLIF(TRIM(r2.nft_token_id), '')) AS asset_key,
      r2.prize_deposited_at,
      r2.created_at
    FROM raffles r2
    WHERE r2.prize_type = 'nft'
      AND COALESCE(NULLIF(TRIM(r2.nft_mint_address), ''), NULLIF(TRIM(r2.nft_token_id), '')) IS NOT NULL
      AND (
        r2.status IS NULL
        OR r2.status IN (
          'draft',
          'live',
          'ready_to_draw',
          'pending_min_not_met',
          'successful_pending_claims'
        )
      )
  ) c
) ranked
WHERE r.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_raffles_nft_non_terminal_prize_asset_unique
ON raffles (
  (COALESCE(NULLIF(TRIM(nft_mint_address), ''), NULLIF(TRIM(nft_token_id), '')))
)
WHERE prize_type = 'nft'
  AND COALESCE(NULLIF(TRIM(nft_mint_address), ''), NULLIF(TRIM(nft_token_id), '')) IS NOT NULL
  AND (
    status IS NULL
    OR status IN (
      'draft',
      'live',
      'ready_to_draw',
      'pending_min_not_met',
      'successful_pending_claims'
    )
  );
