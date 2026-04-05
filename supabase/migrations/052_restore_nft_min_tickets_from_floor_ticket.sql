-- =============================================================================
-- EMERGENCY: Restore NFT min_tickets from floor_price ÷ ticket_price
-- =============================================================================
-- Use when min_tickets was incorrectly mass-updated (e.g. forced to 50) so ended
-- raffles no longer pick winners until the real threshold is met again.
--
-- Run in Supabase → SQL Editor. Does NOT depend on migrations 050/051 being applied.
--
-- LIMITATION: Restored value = round(trim(floor_price)::numeric / ticket_price).
-- If ticket_price was also overwritten (e.g. to floor÷50), this cannot recover a
-- higher historical threshold — only a DB backup can.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP A — PREVIEW ONLY (run first). Rows listed here will change on STEP B.
-- ---------------------------------------------------------------------------
SELECT r.id,
       r.slug,
       r.status,
       r.min_tickets AS current_min,
       calc.expected_min AS restored_min,
       r.floor_price,
       r.ticket_price,
       r.max_tickets
FROM public.raffles r
INNER JOIN (
  SELECT
    id,
    GREATEST(
      1,
      ROUND((TRIM(BOTH FROM floor_price))::numeric / NULLIF(ticket_price::numeric, 0))
    )::integer AS expected_min
  FROM public.raffles
  WHERE lower(coalesce(prize_type, '')) = 'nft'
    AND floor_price IS NOT NULL
    AND TRIM(BOTH FROM floor_price) <> ''
    AND ticket_price IS NOT NULL
    AND ticket_price > 0
    AND TRIM(BOTH FROM floor_price) ~ '^[0-9]+(\.[0-9]*)?$'
) calc ON r.id = calc.id
WHERE r.min_tickets IS DISTINCT FROM calc.expected_min
ORDER BY r.slug;

-- ---------------------------------------------------------------------------
-- STEP B — APPLY (run after STEP A looks correct). Comment out STEP A when running.
-- Sets max_tickets to NULL if it was below the restored draw goal (invalid cap).
-- ---------------------------------------------------------------------------
UPDATE public.raffles r
SET
  min_tickets = calc.expected_min,
  max_tickets = CASE
    WHEN r.max_tickets IS NOT NULL AND r.max_tickets < calc.expected_min THEN NULL
    ELSE r.max_tickets
  END,
  updated_at = NOW()
FROM (
  SELECT
    id,
    GREATEST(
      1,
      ROUND((TRIM(BOTH FROM floor_price))::numeric / NULLIF(ticket_price::numeric, 0))
    )::integer AS expected_min
  FROM public.raffles
  WHERE lower(coalesce(prize_type, '')) = 'nft'
    AND floor_price IS NOT NULL
    AND TRIM(BOTH FROM floor_price) <> ''
    AND ticket_price IS NOT NULL
    AND ticket_price > 0
    AND TRIM(BOTH FROM floor_price) ~ '^[0-9]+(\.[0-9]*)?$'
) calc
WHERE r.id = calc.id
  AND r.min_tickets IS DISTINCT FROM calc.expected_min;
