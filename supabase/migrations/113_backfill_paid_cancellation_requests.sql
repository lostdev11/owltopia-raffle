-- Treat verified cancellation-fee payments as pending creator cancellation requests.
-- This repairs rows where the fee was recorded but the admin queue timestamp was missing.
UPDATE public.raffles
SET cancellation_requested_at = cancellation_fee_paid_at
WHERE cancellation_requested_at IS NULL
  AND cancellation_fee_paid_at IS NOT NULL
  AND COALESCE(status, '') <> 'cancelled';
