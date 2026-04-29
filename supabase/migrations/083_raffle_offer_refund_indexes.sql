-- Speed up offer-refund candidate lookup and stale pending-offer expiry checks.

CREATE INDEX IF NOT EXISTS idx_raffle_offers_buyer_status_refunded
  ON public.raffle_offers (buyer_wallet, status, refunded_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_raffle_offers_buyer_pending_expires_at
  ON public.raffle_offers (buyer_wallet, expires_at)
  WHERE status = 'pending';
