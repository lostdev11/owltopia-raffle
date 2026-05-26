-- =============================================================================
-- Clear stale "pending cancellation" queue rows (Supabase SQL)
-- =============================================================================
-- The admin queue lists raffles where cancellation_requested_at or cancellation_fee_paid_at
-- is set. If the listing already moved to completed / failed_refund_available / etc., those
-- flags are noise — use this after confirming nothing is still live or ready_to_draw.
--
-- Keeps cancellation_fee_payment_tx for audit when only timestamps are cleared.
-- =============================================================================

-- Preview
SELECT id, slug, status, cancellation_requested_at, cancellation_fee_paid_at, winner_wallet
FROM public.raffles
WHERE status NOT IN ('live', 'ready_to_draw', 'cancelled')
  AND (cancellation_requested_at IS NOT NULL OR cancellation_fee_paid_at IS NOT NULL)
ORDER BY cancellation_requested_at DESC NULLS LAST;

/*
UPDATE public.raffles
SET
  cancellation_requested_at = NULL,
  cancellation_fee_paid_at = NULL,
  updated_at = NOW()
WHERE status NOT IN ('live', 'ready_to_draw', 'cancelled')
  AND (cancellation_requested_at IS NOT NULL OR cancellation_fee_paid_at IS NOT NULL);
*/
