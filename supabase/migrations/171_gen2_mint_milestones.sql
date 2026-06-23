-- Escrowed mint milestones for Owl Center launches (gen2 + future creator launches).
-- Mirror of raffle_milestones but keyed by launch and triggered by mint count.
-- Crypto (SOL/USDC) prizes only in v1; NFT prize columns reserved.
CREATE TABLE IF NOT EXISTS gen2_mint_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id UUID NOT NULL REFERENCES owl_center_launches(id) ON DELETE CASCADE,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('absolute_mints', 'percent_supply')),
  trigger_value NUMERIC NOT NULL CHECK (trigger_value > 0),
  prize_type TEXT NOT NULL DEFAULT 'crypto' CHECK (prize_type IN ('crypto', 'nft')),
  prize_amount NUMERIC CHECK (prize_amount IS NULL OR prize_amount > 0),
  prize_currency TEXT CHECK (prize_currency IS NULL OR prize_currency IN ('SOL', 'USDC')),
  nft_mint_address TEXT,
  nft_token_id TEXT,
  winner_mode TEXT NOT NULL DEFAULT 'random' CHECK (winner_mode IN ('random', 'top_buyer')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'unlocked', 'awarded', 'claimed', 'returned', 'void')
  ),
  -- Mint count at which this milestone is configured to unlock (snapshot for display / audit).
  trigger_mint_target INTEGER,
  unlocked_at TIMESTAMPTZ,
  unlocked_at_minted_count INTEGER,
  winner_wallet TEXT,
  winner_selected_at TIMESTAMPTZ,
  winner_selection_mode TEXT CHECK (
    winner_selection_mode IS NULL OR winner_selection_mode IN ('auto_random', 'auto_top_buyer')
  ),
  -- Wallet that funded the prize escrow (admin or launch creator); deposit returns go here.
  funded_by_wallet TEXT,
  deposit_tx TEXT,
  deposit_verified_at TIMESTAMPTZ,
  claim_tx TEXT,
  claimed_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ,
  return_tx TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gen2_mint_milestones_trigger_percent CHECK (
    trigger_type <> 'percent_supply' OR (trigger_value > 0 AND trigger_value <= 100)
  ),
  CONSTRAINT gen2_mint_milestones_crypto_prize CHECK (
    prize_type <> 'crypto'
    OR (prize_amount IS NOT NULL AND prize_amount > 0 AND prize_currency IS NOT NULL)
  ),
  CONSTRAINT gen2_mint_milestones_nft_prize CHECK (
    prize_type <> 'nft'
    OR (nft_mint_address IS NOT NULL OR nft_token_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_gen2_mint_milestones_launch ON gen2_mint_milestones(launch_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gen2_mint_milestones_launch_sort ON gen2_mint_milestones(launch_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_gen2_mint_milestones_winner ON gen2_mint_milestones(winner_wallet)
  WHERE winner_wallet IS NOT NULL;

ALTER TABLE gen2_mint_milestones ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE gen2_mint_milestones IS
  'Prefunded side prizes on Owl Center launches unlocked by mint count; a random/top minter wins. API + service role only.';

-- API-only: Next.js writes/reads via getSupabaseAdmin(); no anon/authenticated policies.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gen2_mint_milestones TO service_role;
