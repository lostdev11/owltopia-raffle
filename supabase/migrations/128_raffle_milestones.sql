-- Escrowed side-prize milestones on raffles (SOL/USDC crypto v1; NFT prize columns reserved).
CREATE TABLE IF NOT EXISTS raffle_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raffle_id UUID NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('percent_max', 'absolute_tickets')),
  trigger_value NUMERIC NOT NULL CHECK (trigger_value > 0),
  prize_type TEXT NOT NULL CHECK (prize_type IN ('crypto', 'nft')),
  prize_amount NUMERIC CHECK (prize_amount IS NULL OR prize_amount > 0),
  prize_currency TEXT CHECK (prize_currency IS NULL OR prize_currency IN ('SOL', 'USDC')),
  nft_mint_address TEXT,
  nft_token_id TEXT,
  winner_mode TEXT NOT NULL CHECK (winner_mode IN ('random', 'top_buyer', 'creator_initiated_pull')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'unlocked', 'awarded', 'claimed', 'returned', 'void')
  ),
  unlocked_at TIMESTAMPTZ,
  winner_wallet TEXT,
  winner_selected_at TIMESTAMPTZ,
  winner_selection_mode TEXT CHECK (
    winner_selection_mode IS NULL OR winner_selection_mode IN (
      'creator_triggered_random', 'auto_random', 'auto_top_buyer'
    )
  ),
  deposit_tx TEXT,
  deposit_verified_at TIMESTAMPTZ,
  claim_tx TEXT,
  claimed_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ,
  return_tx TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT raffle_milestones_trigger_percent CHECK (
    trigger_type <> 'percent_max' OR (trigger_value > 0 AND trigger_value <= 100)
  ),
  CONSTRAINT raffle_milestones_crypto_prize CHECK (
    prize_type <> 'crypto'
    OR (prize_amount IS NOT NULL AND prize_amount > 0 AND prize_currency IS NOT NULL)
  ),
  CONSTRAINT raffle_milestones_nft_prize CHECK (
    prize_type <> 'nft'
    OR (nft_mint_address IS NOT NULL OR nft_token_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_raffle_milestones_raffle ON raffle_milestones(raffle_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_raffle_milestones_raffle_sort ON raffle_milestones(raffle_id, sort_order);

ALTER TABLE raffle_milestones ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE raffle_milestones IS
  'Prefunded side prizes unlocked by ticket sales; pay only when raffle draw threshold succeeds.';

-- API-only: Next.js uses getSupabaseAdmin(); no anon/authenticated policies.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.raffle_milestones TO service_role;
