-- =============================================================================
-- Manual: reopen / extend a raffle that ended with no winner (Supabase SQL)
-- =============================================================================
-- Use when you cannot deploy the admin UI yet. Replace placeholders.
--
-- Preconditions:
--   - No winner (winner_wallet / winner_selected_at empty)
--   - prize_returned_at IS NULL (if NFT was returned to creator, do not reopen blindly)
--
-- Pick a new end_time in the future (UTC in Postgres timestamptz).
-- =============================================================================

-- Preview
SELECT id, slug, status, end_time, is_active, winner_wallet, prize_returned_at, time_extension_count
FROM public.raffles
WHERE slug = 'YOUR-SLUG-HERE';

/*
UPDATE public.raffles
SET
  end_time = (NOW() AT TIME ZONE 'utc') + INTERVAL '72 hours',
  status = 'live',
  is_active = true,
  edited_after_entries = true,
  time_extension_count = COALESCE(time_extension_count, 0),
  updated_at = NOW()
WHERE slug = 'YOUR-SLUG-HERE'
  AND winner_wallet IS NULL
  AND winner_selected_at IS NULL
  AND prize_returned_at IS NULL;
*/

-- Optional: fix draw goal in same pass (NFT example — adjust numbers)
/*
UPDATE public.raffles
SET
  min_tickets = 200,
  ticket_price = round((trim(both from floor_price)::numeric / 200)::numeric, 6),
  updated_at = NOW()
WHERE slug = 'YOUR-SLUG-HERE'
  AND lower(coalesce(prize_type, '')) = 'nft';
*/
