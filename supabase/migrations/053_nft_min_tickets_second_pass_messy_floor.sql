-- =============================================================================
-- Second pass: fix NFT raffles still at min_tickets = 50 after 052
-- =============================================================================
-- WARNING: Same as 052 — scope STEP B to specific rows or statuses if possible; avoid
-- blind global UPDATE on all NFT raffles unless that is explicitly intended.
--
-- 052 only updates rows where trim(floor_price) is a plain decimal string.
-- Human-readable values (e.g. "2.5 SOL", commas) fail that check — the UI still
-- shows Draw Threshold 50 because it reads raffles.min_tickets from the DB.
--
-- This pass strips commas, takes the first decimal number in floor_price, and
-- updates only NFT rows still at min_tickets = 50 when the recomputed goal differs.
-- Same limitation as 052: if ticket_price was set to floor÷50, a higher historical
-- goal cannot be recovered without a backup.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP A — PREVIEW (optional; comment out when you only want STEP B)
-- ---------------------------------------------------------------------------
WITH parsed AS (
  SELECT
    id,
    slug,
    status,
    min_tickets,
    floor_price,
    ticket_price,
    max_tickets,
    NULLIF(
      substring(
        regexp_replace(trim(both from floor_price), ',', '', 'g')
        from '[0-9]+(\.[0-9]+)?'
      ),
      ''
    ) AS floor_token
  FROM public.raffles
  WHERE lower(coalesce(prize_type, '')) = 'nft'
    AND min_tickets = 50
    AND floor_price IS NOT NULL
    AND trim(both from floor_price) <> ''
    AND ticket_price IS NOT NULL
    AND ticket_price > 0
),
calc AS (
  SELECT
    id,
    slug,
    status,
    min_tickets AS current_min,
    floor_price,
    ticket_price,
    max_tickets,
    GREATEST(
      1,
      round((floor_token)::numeric / nullif(ticket_price::numeric, 0))
    )::integer AS expected_min
  FROM parsed
  WHERE floor_token IS NOT NULL
    AND floor_token ~ '^[0-9]+(\.[0-9]*)?$'
)
SELECT id,
       slug,
       status,
       current_min,
       expected_min AS restored_min,
       floor_price,
       ticket_price,
       max_tickets
FROM calc
WHERE expected_min IS DISTINCT FROM current_min
ORDER BY slug;

-- ---------------------------------------------------------------------------
-- STEP B — APPLY
-- ---------------------------------------------------------------------------
UPDATE public.raffles r
SET
  min_tickets = c.expected_min,
  max_tickets = CASE
    WHEN r.max_tickets IS NOT NULL AND r.max_tickets < c.expected_min THEN NULL
    ELSE r.max_tickets
  END,
  updated_at = NOW()
FROM (
  SELECT
    id,
    GREATEST(
      1,
      round((floor_token)::numeric / nullif(ticket_price::numeric, 0))
    )::integer AS expected_min
  FROM (
    SELECT
      id,
      ticket_price,
      NULLIF(
        substring(
          regexp_replace(trim(both from floor_price), ',', '', 'g')
          from '[0-9]+(\.[0-9]+)?'
        ),
        ''
      ) AS floor_token
    FROM public.raffles
    WHERE lower(coalesce(prize_type, '')) = 'nft'
      AND min_tickets = 50
      AND floor_price IS NOT NULL
      AND trim(both from floor_price) <> ''
      AND ticket_price IS NOT NULL
      AND ticket_price > 0
  ) p
  WHERE floor_token IS NOT NULL
    AND floor_token ~ '^[0-9]+(\.[0-9]*)?$'
) c
WHERE r.id = c.id
  AND r.min_tickets = 50
  AND c.expected_min IS DISTINCT FROM r.min_tickets;
