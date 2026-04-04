-- Migration 044 set ticket_payments_to_funds_escrow = false for any raffle that had confirmed entries.
-- After those sales were refunded (refunded_at set), the flag stayed false forever, hiding raffles from
-- the live claim tracker and keeping checkout on split-at-purchase. Re-enable funds escrow when there is
-- no remaining unrefunded confirmed entry, for raffles that can still accept purchases.

UPDATE raffles r
SET ticket_payments_to_funds_escrow = true
WHERE r.ticket_payments_to_funds_escrow = false
  AND r.status IN ('draft', 'live', 'ready_to_draw')
  AND NOT EXISTS (
    SELECT 1
    FROM entries e
    WHERE e.raffle_id = r.id
      AND e.status = 'confirmed'
      AND e.refunded_at IS NULL
  );
