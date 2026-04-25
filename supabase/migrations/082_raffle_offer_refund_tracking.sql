-- Track offer escrow funding + buyer refund claims.

ALTER TABLE public.raffle_offers
  ADD COLUMN IF NOT EXISTS funded_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.raffle_offers
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz NULL;

ALTER TABLE public.raffle_offers
  ADD COLUMN IF NOT EXISTS refund_tx_signature text NULL;
