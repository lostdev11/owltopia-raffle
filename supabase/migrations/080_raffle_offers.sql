-- Post-win raffle offers (24h window from winner selection).

CREATE TABLE IF NOT EXISTS public.raffle_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raffle_id uuid NOT NULL REFERENCES public.raffles(id) ON DELETE CASCADE,
  buyer_wallet text NOT NULL,
  amount numeric(20, 9) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency IN ('SOL', 'USDC', 'OWL')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz NULL,
  accepted_by_wallet text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raffle_offers_raffle_id_created_at
  ON public.raffle_offers (raffle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_raffle_offers_raffle_id_status
  ON public.raffle_offers (raffle_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_raffle_offers_one_pending_per_wallet
  ON public.raffle_offers (raffle_id, buyer_wallet)
  WHERE status = 'pending';

ALTER TABLE public.raffle_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS raffle_offers_select_all ON public.raffle_offers;
CREATE POLICY raffle_offers_select_all
  ON public.raffle_offers
  FOR SELECT
  USING (true);
