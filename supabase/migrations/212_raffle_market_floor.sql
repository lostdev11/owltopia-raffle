-- Live marketplace floor snapshot for NFT raffles (display only).
-- Does NOT replace listed floor_price / ticket_price / draw-goal economics.

ALTER TABLE public.raffles
  ADD COLUMN IF NOT EXISTS market_floor_sol numeric,
  ADD COLUMN IF NOT EXISTS market_floor_fetched_at timestamptz,
  ADD COLUMN IF NOT EXISTS market_floor_source text,
  ADD COLUMN IF NOT EXISTS market_floor_collection_symbol text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'raffles_market_floor_source_check'
      AND conrelid = 'public.raffles'::regclass
  ) THEN
    ALTER TABLE public.raffles
      ADD CONSTRAINT raffles_market_floor_source_check
      CHECK (
        market_floor_source IS NULL
        OR market_floor_source IN ('magic_eden', 'tensor', 'none')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.raffles.market_floor_sol IS
  'Latest collection floor in SOL from a marketplace oracle (display only; never drives ticket price or draw goal).';
COMMENT ON COLUMN public.raffles.market_floor_fetched_at IS
  'When market_floor_sol was last refreshed from a marketplace API.';
COMMENT ON COLUMN public.raffles.market_floor_source IS
  'Oracle that produced market_floor_sol: magic_eden | tensor | none.';
COMMENT ON COLUMN public.raffles.market_floor_collection_symbol IS
  'Marketplace collection slug/symbol used for the floor lookup (e.g. Magic Eden symbol).';

-- Cron: refresh live / ready_to_draw NFT raffles with stale or missing market floors.
CREATE INDEX IF NOT EXISTS idx_raffles_market_floor_refresh
  ON public.raffles (market_floor_fetched_at ASC NULLS FIRST)
  WHERE prize_type = 'nft'
    AND status IN ('live', 'ready_to_draw')
    AND nft_mint_address IS NOT NULL;
