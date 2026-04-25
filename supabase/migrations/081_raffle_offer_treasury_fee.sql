-- Treasury fee on accepted raffle offers: 0.5% (50 bps).

ALTER TABLE public.raffle_offers
  ADD COLUMN IF NOT EXISTS treasury_fee_bps integer NOT NULL DEFAULT 50;

ALTER TABLE public.raffle_offers
  ADD COLUMN IF NOT EXISTS treasury_fee_amount numeric(20, 9) NULL;

ALTER TABLE public.raffle_offers
  ADD COLUMN IF NOT EXISTS winner_net_amount numeric(20, 9) NULL;

ALTER TABLE public.raffle_offers
  DROP CONSTRAINT IF EXISTS raffle_offers_treasury_fee_bps_check;

ALTER TABLE public.raffle_offers
  ADD CONSTRAINT raffle_offers_treasury_fee_bps_check
  CHECK (treasury_fee_bps >= 0 AND treasury_fee_bps <= 10_000);
