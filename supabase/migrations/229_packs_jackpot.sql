-- Accumulating SOL jackpot: 0.02 SOL per pack open (configurable) into pool; rare full-pool wins.

ALTER TABLE public.pack_vault_config
  ADD COLUMN IF NOT EXISTS jackpot_pool_sol numeric(18, 9) NOT NULL DEFAULT 0
    CHECK (jackpot_pool_sol >= 0),
  ADD COLUMN IF NOT EXISTS jackpot_contribution_sol numeric(18, 9) NOT NULL DEFAULT 0.02
    CHECK (jackpot_contribution_sol > 0),
  ADD COLUMN IF NOT EXISTS jackpot_win_odds_bps integer NOT NULL DEFAULT 20
    CHECK (jackpot_win_odds_bps > 0 AND jackpot_win_odds_bps <= 10000);

COMMENT ON COLUMN public.pack_vault_config.jackpot_pool_sol IS
  'Accumulated SOL jackpot pool (liability from pack sales; paid out on jackpot wins).';
COMMENT ON COLUMN public.pack_vault_config.jackpot_contribution_sol IS
  'SOL added to jackpot pool per completed pack open (default 0.02 of 0.1 pack).';
COMMENT ON COLUMN public.pack_vault_config.jackpot_win_odds_bps IS
  'Jackpot win probability in bps (20 = 0.2% ≈ 1 in 500 opens).';

ALTER TABLE public.pack_opens
  ADD COLUMN IF NOT EXISTS is_jackpot_win boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS jackpot_contribution_sol numeric(18, 9),
  ADD COLUMN IF NOT EXISTS jackpot_amount_sol numeric(18, 9);

COMMENT ON COLUMN public.pack_opens.is_jackpot_win IS
  'True when this open won the accumulated SOL jackpot (replaces regular category prize).';
COMMENT ON COLUMN public.pack_opens.jackpot_contribution_sol IS
  'SOL contributed to the jackpot pool on this open.';
COMMENT ON COLUMN public.pack_opens.jackpot_amount_sol IS
  'SOL paid from the jackpot pool when is_jackpot_win = true.';

-- Allow category = jackpot on completed opens
ALTER TABLE public.pack_opens DROP CONSTRAINT IF EXISTS pack_opens_category_check;
ALTER TABLE public.pack_opens ADD CONSTRAINT pack_opens_category_check CHECK (
  category IS NULL OR category IN ('owl', 'sol', 'nft', 'jackpot')
);

CREATE INDEX IF NOT EXISTS pack_opens_jackpot_wins_idx
  ON public.pack_opens (completed_at DESC)
  WHERE status = 'completed' AND is_jackpot_win = true;
