-- Admin creator blacklist, strike ledger, and per-raffle buyer caution + listing fee.

CREATE TABLE IF NOT EXISTS public.creator_blacklist (
  wallet_address TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  added_by TEXT NOT NULL,
  notes TEXT,
  strike_count INT NOT NULL DEFAULT 0 CHECK (strike_count >= 0),
  banned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.creator_blacklist IS 'Admin-flagged creator wallets. Listing requires a moderation deposit; strikes accrue on paid go-live.';
COMMENT ON COLUMN public.creator_blacklist.strike_count IS 'Paid go-lives while blacklisted (0–3). At 3, wallet cannot create new raffles.';
COMMENT ON COLUMN public.creator_blacklist.banned_at IS 'Optional hard ban timestamp (admin or auto at strike 3).';

CREATE INDEX IF NOT EXISTS idx_creator_blacklist_strike_count ON public.creator_blacklist(strike_count);

CREATE TABLE IF NOT EXISTS public.creator_moderation_strike_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  strike_number INT NOT NULL CHECK (strike_number >= 1),
  raffle_id UUID NOT NULL REFERENCES public.raffles(id) ON DELETE CASCADE,
  listing_fee_lamports BIGINT NOT NULL CHECK (listing_fee_lamports > 0),
  listing_fee_payment_tx TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_moderation_strike_events_raffle
  ON public.creator_moderation_strike_events(raffle_id);

CREATE INDEX IF NOT EXISTS idx_creator_moderation_strike_events_wallet
  ON public.creator_moderation_strike_events(wallet_address, created_at DESC);

COMMENT ON TABLE public.creator_moderation_strike_events IS 'Audit: one row per blacklisted creator paid go-live.';

ALTER TABLE public.raffles
  ADD COLUMN IF NOT EXISTS creator_restricted_listing BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS moderation_listing_fee_lamports BIGINT,
  ADD COLUMN IF NOT EXISTS moderation_listing_fee_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS moderation_listing_fee_payment_tx TEXT;

COMMENT ON COLUMN public.raffles.creator_restricted_listing IS 'When true, show buyer caution — host was on admin moderation list at create time.';
COMMENT ON COLUMN public.raffles.moderation_listing_fee_lamports IS 'Required SOL listing deposit (lamports) before go-live for restricted creators.';
COMMENT ON COLUMN public.raffles.moderation_listing_fee_paid_at IS 'When creator paid the moderation listing deposit.';
COMMENT ON COLUMN public.raffles.moderation_listing_fee_payment_tx IS 'Solana tx signature of moderation listing deposit.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_raffles_moderation_listing_fee_payment_tx
  ON public.raffles(moderation_listing_fee_payment_tx)
  WHERE moderation_listing_fee_payment_tx IS NOT NULL;

-- API-only: Next.js admin routes via service role.
ALTER TABLE public.creator_blacklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_moderation_strike_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.creator_blacklist TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creator_moderation_strike_events TO service_role;
