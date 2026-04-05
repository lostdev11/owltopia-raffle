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

-- Optional: restore from `cancelled` (clears cancellation metadata — only if refunds/support are OK)
/*
UPDATE public.raffles
SET
  end_time = (NOW() AT TIME ZONE 'utc') + INTERVAL '72 hours',
  status = 'live',
  is_active = true,
  edited_after_entries = true,
  cancelled_at = NULL,
  cancellation_requested_at = NULL,
  cancellation_fee_amount = NULL,
  cancellation_fee_currency = NULL,
  cancellation_refund_policy = NULL,
  updated_at = NOW()
WHERE slug = 'YOUR-SLUG-HERE'
  AND winner_wallet IS NULL
  AND winner_selected_at IS NULL
  AND prize_returned_at IS NULL;
*/

-- =============================================================================
-- Manual: void erroneous winner + reopen (same rules as API void_winner_admin_override)
-- =============================================================================
-- Only if: nft_transfer_transaction empty, creator_claimed_at IS NULL,
--   creator_funds_claim_locked_at IS NULL, prize_returned_at IS NULL.
-- =============================================================================
/*
SELECT id, slug, status, winner_wallet, nft_transfer_transaction, creator_claimed_at, prize_returned_at
FROM public.raffles
WHERE slug = 'YOUR-SLUG-HERE';

UPDATE public.raffles
SET
  winner_wallet = NULL,
  winner_selected_at = NULL,
  settled_at = NULL,
  fee_bps_applied = NULL,
  fee_tier_reason = NULL,
  platform_fee_amount = NULL,
  creator_payout_amount = NULL,
  nft_claim_locked_at = NULL,
  nft_claim_locked_wallet = NULL,
  creator_claimed_at = NULL,
  creator_claim_tx = NULL,
  creator_funds_claim_locked_at = NULL,
  end_time = (NOW() AT TIME ZONE 'utc') + INTERVAL '72 hours',
  status = 'live',
  is_active = true,
  edited_after_entries = true,
  updated_at = NOW()
WHERE slug = 'YOUR-SLUG-HERE'
  AND winner_wallet IS NOT NULL
  AND coalesce(trim(nft_transfer_transaction), '') = ''
  AND creator_claimed_at IS NULL
  AND coalesce(trim(creator_funds_claim_locked_at::text), '') = ''
  AND prize_returned_at IS NULL;
*/
