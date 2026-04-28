-- ============================================================================
-- 087: NFT buyout offers (v1: post-draw only; no pre-bids).
-- Bidders deposit to platform treasury; winner accepts one offer (1% fee);
-- expired/superseded bids refund from treasury when RAFFLE_RECIPIENT_SECRET_KEY is set.
-- ============================================================================

ALTER TABLE public.raffles
  ADD COLUMN IF NOT EXISTS buyout_closed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.raffles.buyout_closed_at IS 'When set, buyout bidding is closed (winner accepted an offer).';

CREATE TABLE IF NOT EXISTS public.raffle_buyout_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raffle_id UUID NOT NULL REFERENCES public.raffles(id) ON DELETE CASCADE,
  bidder_wallet TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('SOL', 'USDC')),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (
    status IN (
      'pending_deposit',
      'active',
      'accepted',
      'expired',
      'refunded',
      'superseded'
    )
  ),
  deposit_tx_signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  accepted_by_wallet TEXT,
  treasury_fee_bps INT NOT NULL DEFAULT 100,
  treasury_fee_amount NUMERIC,
  winner_net_amount NUMERIC,
  payout_tx_signature TEXT,
  refund_tx_signature TEXT,
  refunded_at TIMESTAMPTZ,
  CONSTRAINT raffle_buyout_offers_deposit_tx_unique UNIQUE (deposit_tx_signature)
);

CREATE UNIQUE INDEX IF NOT EXISTS raffle_buyout_one_accepted_per_raffle
  ON public.raffle_buyout_offers (raffle_id)
  WHERE status = 'accepted';

CREATE INDEX IF NOT EXISTS raffle_buyout_offers_raffle_id_idx ON public.raffle_buyout_offers (raffle_id);
CREATE INDEX IF NOT EXISTS raffle_buyout_offers_bidder_wallet_idx ON public.raffle_buyout_offers (bidder_wallet);
CREATE INDEX IF NOT EXISTS raffle_buyout_offers_status_expires_idx ON public.raffle_buyout_offers (status, expires_at);

ALTER TABLE public.raffle_buyout_offers ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.raffle_buyout_offers IS 'Post-draw buyout bids on NFT prizes; API uses service role only.';
