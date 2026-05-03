-- Per-wallet thumbs up/down on raffles (anonymous tallies; writes via Next.js API + service role).

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

COMMENT ON TABLE public.raffle_sentiment IS 'Thumbs up/down per wallet per raffle; aggregates and upserts via Next.js API + service role only.';
