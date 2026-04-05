-- Run in Supabase → SQL Editor (read-only checks).
--
-- 1) Is migration 050 applied? Expect 3 rows (constraint names).
SELECT c.conname AS constraint_name
FROM pg_constraint c
JOIN pg_class t ON c.conrelid = t.oid
JOIN pg_namespace n ON t.relnamespace = n.oid
WHERE n.nspname = 'public'
  AND t.relname = 'raffles'
  AND c.conname IN (
    'raffles_nft_min_tickets_fixed',
    'raffles_nft_max_tickets_minimum',
    'raffles_nft_prize_amount_null'
  )
ORDER BY c.conname;

-- 2) NFT rows that violate those CHECK rules.
--    If migration 050 succeeded, this MUST return 0 rows (Postgres rejects invalid data).
--    If you see rows here, 050 was never applied or constraints were dropped.
SELECT id,
       slug,
       status,
       min_tickets,
       max_tickets,
       prize_amount,
       floor_price,
       ticket_price
FROM public.raffles
WHERE lower(coalesce(prize_type, '')) = 'nft'
  AND (
    min_tickets IS DISTINCT FROM 50
    OR (max_tickets IS NOT NULL AND max_tickets < 50)
    OR prize_amount IS NOT NULL
  )
ORDER BY slug;
