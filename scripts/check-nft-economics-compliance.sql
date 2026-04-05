-- Run in Supabase SQL Editor (read-only).
-- After migration 051, the old "fixed 50" constraints are gone — use these data checks instead.

-- NFT rows where min_tickets ≠ round(floor_price::numeric / ticket_price::numeric)
-- (Postgres numeric; trim floor_price text first.)
SELECT id,
       slug,
       min_tickets,
       floor_price,
       ticket_price,
       GREATEST(1, ROUND(TRIM(floor_price)::numeric / NULLIF(ticket_price, 0))) AS expected_min
FROM public.raffles
WHERE lower(coalesce(prize_type, '')) = 'nft'
  AND floor_price IS NOT NULL
  AND TRIM(floor_price) <> ''
  AND ticket_price IS NOT NULL
  AND ticket_price > 0
  AND min_tickets IS DISTINCT FROM GREATEST(1, ROUND(TRIM(floor_price)::numeric / NULLIF(ticket_price, 0)))
ORDER BY slug;

-- max_tickets below computed draw goal
SELECT r.id,
       r.slug,
       r.min_tickets,
       r.max_tickets,
       r.floor_price,
       r.ticket_price
FROM public.raffles r
WHERE lower(coalesce(r.prize_type, '')) = 'nft'
  AND r.max_tickets IS NOT NULL
  AND r.min_tickets IS NOT NULL
  AND r.max_tickets < r.min_tickets
ORDER BY r.slug;
