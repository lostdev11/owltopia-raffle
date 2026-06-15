-- NFT giveaways: admin deposits to prize escrow; single eligible wallet claims via session.
CREATE TABLE IF NOT EXISTS nft_giveaways (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT,
  nft_mint_address TEXT NOT NULL,
  nft_token_id TEXT,
  prize_standard TEXT CHECK (
    prize_standard IS NULL OR prize_standard IN ('spl', 'token2022', 'mpl_core', 'compressed')
  ),
  eligible_wallet TEXT NOT NULL,
  deposit_tx_signature TEXT,
  prize_deposited_at TIMESTAMPTZ,
  claim_tx_signature TEXT,
  claimed_at TIMESTAMPTZ,
  nft_claim_locked_at TIMESTAMPTZ,
  nft_claim_locked_wallet TEXT,
  created_by_wallet TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nft_giveaways_eligible_wallet ON nft_giveaways(eligible_wallet);
CREATE INDEX IF NOT EXISTS idx_nft_giveaways_pending ON nft_giveaways(eligible_wallet)
  WHERE claimed_at IS NULL AND prize_deposited_at IS NOT NULL;

CREATE TRIGGER update_nft_giveaways_updated_at BEFORE UPDATE ON nft_giveaways
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE nft_giveaways ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE nft_giveaways IS 'One-off NFT claims from prize escrow; API uses service role.';
