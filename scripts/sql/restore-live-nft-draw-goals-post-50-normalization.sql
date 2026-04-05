-- =============================================================================
-- All active NFT raffles — recover draw goals after mistaken “50 ticket” rollout
-- =============================================================================
-- Postgres does not store the previous min_tickets once updated. This script uses:
--
--   PASS 1 — SYNC (safe): min_tickets is still 50 but ticket_price already matches
--   a higher goal (floor ÷ ticket > 50). Updates only min_tickets (and max if needed).
--
--   PASS 2 — RESTORE (risky): min_tickets = 50 AND floor ÷ ticket = 50 (the floor÷50
--   ticket model). Optionally rewrite to a single restored goal (default 200 tickets).
--   This WILL also match raffles that were legitimately created as 50-ticket raffles.
--   Use STEP B2 + exclusions, or restore per-slug with different targets.
--
-- Scope: status IN ('live', 'ready_to_draw'). Add other statuses in the WHERE if needed.
-- floor_price must match plain decimal regex below; messy text needs manual fixes (see 053).
--
-- Run STEP A / B in Supabase SQL Editor first. Uncomment PASS 1 UPDATE, then PASS 2 if needed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP A — Preview: active NFT raffles + implied goal from current prices
-- ---------------------------------------------------------------------------
SELECT
  r.id,
  r.slug,
  r.title,
  r.status,
  r.min_tickets AS db_min,
  r.floor_price,
  r.ticket_price,
  CASE
    WHEN r.floor_price IS NOT NULL
      AND trim(both from r.floor_price) <> ''
      AND trim(both from r.floor_price) ~ '^[0-9]+(\.[0-9]*)?$'
      AND r.ticket_price IS NOT NULL
      AND r.ticket_price > 0
    THEN round((trim(both from r.floor_price)::numeric / r.ticket_price::numeric))::integer
    ELSE NULL
  END AS implied_goal
FROM public.raffles r
WHERE lower(coalesce(r.prize_type, '')) = 'nft'
  AND lower(coalesce(r.status, '')) IN ('live', 'ready_to_draw')
ORDER BY r.slug;

-- ---------------------------------------------------------------------------
-- STEP B1 — PASS 1 candidates: min stuck at 50, math says higher (no ticket change)
-- ---------------------------------------------------------------------------
SELECT
  r.id,
  r.slug,
  r.title,
  r.min_tickets AS db_min,
  round((trim(both from r.floor_price)::numeric / nullif(r.ticket_price::numeric, 0)))::integer AS new_min
FROM public.raffles r
WHERE lower(coalesce(r.prize_type, '')) = 'nft'
  AND lower(coalesce(r.status, '')) IN ('live', 'ready_to_draw')
  AND r.min_tickets = 50
  AND r.floor_price IS NOT NULL
  AND trim(both from r.floor_price) <> ''
  AND trim(both from r.floor_price) ~ '^[0-9]+(\.[0-9]*)?$'
  AND r.ticket_price IS NOT NULL
  AND r.ticket_price > 0
  AND round((trim(both from r.floor_price)::numeric / r.ticket_price::numeric))::integer > 50;
-- Optional: AND r.slug NOT IN ('keep-this-at-50', ...)

-- ---------------------------------------------------------------------------
-- STEP B2 — PASS 2 candidates: full 50-ticket economics (min=50, implied=50)
-- ---------------------------------------------------------------------------
-- Edit :target_tickets in STEP D (default 200). Rows here get min=:target and ticket=floor/:target.
SELECT
  r.id,
  r.slug,
  r.title,
  r.min_tickets AS db_min,
  r.ticket_price AS current_ticket,
  round((trim(both from r.floor_price)::numeric / 200)::numeric, 6) AS example_ticket_if_goal_200
FROM public.raffles r
WHERE lower(coalesce(r.prize_type, '')) = 'nft'
  AND lower(coalesce(r.status, '')) IN ('live', 'ready_to_draw')
  AND r.min_tickets = 50
  AND r.floor_price IS NOT NULL
  AND trim(both from r.floor_price) <> ''
  AND trim(both from r.floor_price) ~ '^[0-9]+(\.[0-9]*)?$'
  AND r.ticket_price IS NOT NULL
  AND r.ticket_price > 0
  AND round((trim(both from r.floor_price)::numeric / r.ticket_price::numeric))::integer = 50;
-- Optional: AND r.slug NOT IN (...)

-- ---------------------------------------------------------------------------
-- PASS 1 — APPLY SYNC (uncomment to run)
-- ---------------------------------------------------------------------------
/*
UPDATE public.raffles r
SET
  min_tickets = sub.new_min,
  max_tickets = CASE
    WHEN r.max_tickets IS NOT NULL AND r.max_tickets < sub.new_min THEN NULL
    ELSE r.max_tickets
  END,
  updated_at = NOW()
FROM (
  SELECT
    r2.id,
    round((trim(both from r2.floor_price)::numeric / nullif(r2.ticket_price::numeric, 0)))::integer AS new_min
  FROM public.raffles r2
  WHERE lower(coalesce(r2.prize_type, '')) = 'nft'
    AND lower(coalesce(r2.status, '')) IN ('live', 'ready_to_draw')
    AND r2.min_tickets = 50
    AND r2.floor_price IS NOT NULL
    AND trim(both from r2.floor_price) <> ''
    AND trim(both from r2.floor_price) ~ '^[0-9]+(\.[0-9]*)?$'
    AND r2.ticket_price IS NOT NULL
    AND r2.ticket_price > 0
    AND round((trim(both from r2.floor_price)::numeric / r2.ticket_price::numeric))::integer > 50
) sub
WHERE r.id = sub.id;
*/

-- ---------------------------------------------------------------------------
-- PASS 2 — APPLY RESTORE (uncomment; set target ticket goal — default 200)
-- ---------------------------------------------------------------------------
/*
UPDATE public.raffles r
SET
  min_tickets = 200,
  ticket_price = round((trim(both from r.floor_price)::numeric / 200)::numeric, 6),
  max_tickets = CASE
    WHEN r.max_tickets IS NOT NULL AND r.max_tickets < 200 THEN NULL
    ELSE r.max_tickets
  END,
  updated_at = NOW()
WHERE lower(coalesce(r.prize_type, '')) = 'nft'
  AND lower(coalesce(r.status, '')) IN ('live', 'ready_to_draw')
  AND r.min_tickets = 50
  AND r.floor_price IS NOT NULL
  AND trim(both from r.floor_price) <> ''
  AND trim(both from r.floor_price) ~ '^[0-9]+(\.[0-9]*)?$'
  AND r.ticket_price IS NOT NULL
  AND r.ticket_price > 0
  AND round((trim(both from r.floor_price)::numeric / r.ticket_price::numeric))::integer = 50;
*/

-- ---------------------------------------------------------------------------
-- OPTIONAL — Per-slug goals (when originals were not all the same number)
-- ---------------------------------------------------------------------------
-- Uncomment and fill slug + goal; run instead of blanket PASS 2.
/*
UPDATE public.raffles r
SET
  min_tickets = t.goal,
  ticket_price = round((trim(both from r.floor_price)::numeric / t.goal)::numeric, 6),
  max_tickets = CASE
    WHEN r.max_tickets IS NOT NULL AND r.max_tickets < t.goal THEN NULL
    ELSE r.max_tickets
  END,
  updated_at = NOW()
FROM (
  VALUES
    ('example-slug-one', 200),
    ('example-slug-two', 180)
) AS t(slug, goal)
WHERE r.slug = t.slug
  AND lower(coalesce(r.prize_type, '')) = 'nft'
  AND lower(coalesce(r.status, '')) IN ('live', 'ready_to_draw')
  AND r.floor_price IS NOT NULL
  AND trim(both from r.floor_price) <> ''
  AND trim(both from r.floor_price) ~ '^[0-9]+(\.[0-9]*)?$'
  AND r.ticket_price IS NOT NULL
  AND r.ticket_price > 0;
*/
