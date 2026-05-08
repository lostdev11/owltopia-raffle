-- Per-wallet thumbs up/down on raffles (anonymous tallies; writes via Next.js API + service role).
-- Exactly one row per (raffle_id, wallet_address); POST upserts so users can switch between up and down.

CREATE TABLE IF NOT EXISTS public.raffle_sentiment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raffle_id uuid NOT NULL REFERENCES public.raffles (id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  sentiment text NOT NULL CHECK (sentiment IN ('up', 'down')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT raffle_sentiment_raffle_wallet_unique UNIQUE (raffle_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_raffle_sentiment_raffle_id ON public.raffle_sentiment (raffle_id);
CREATE INDEX IF NOT EXISTS idx_raffle_sentiment_wallet ON public.raffle_sentiment (wallet_address);

DROP TRIGGER IF EXISTS update_raffle_sentiment_updated_at ON public.raffle_sentiment;
CREATE TRIGGER update_raffle_sentiment_updated_at
  BEFORE UPDATE ON public.raffle_sentiment
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.raffle_sentiment ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.raffle_sentiment IS 'One ballot per wallet per raffle (unique raffle_id + wallet_address). Sentiment updates replace the prior choice (switch up/down). Reads/writes via Next.js + service role.';

COMMENT ON CONSTRAINT raffle_sentiment_raffle_wallet_unique ON public.raffle_sentiment IS
  'Enforces a single reaction row per wallet per raffle; API upserts to change vote.';
