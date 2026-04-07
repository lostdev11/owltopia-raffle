-- Community giveaways: join pool, optional holder gate, OWL boost before starts_at, admin draw, winner claims NFT from escrow.
CREATE TABLE IF NOT EXISTS community_giveaways (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  access_gate TEXT NOT NULL CHECK (access_gate IN ('open', 'holder_only')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'open', 'drawn', 'cancelled')) DEFAULT 'draft',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  nft_mint_address TEXT NOT NULL,
  nft_token_id TEXT,
  prize_standard TEXT CHECK (
    prize_standard IS NULL OR prize_standard IN ('spl', 'token2022', 'mpl_core', 'compressed')
  ),
  deposit_tx_signature TEXT,
  prize_deposited_at TIMESTAMPTZ,
  winner_wallet TEXT,
  winner_selected_at TIMESTAMPTZ,
  claim_tx_signature TEXT,
  claimed_at TIMESTAMPTZ,
  nft_claim_locked_at TIMESTAMPTZ,
  nft_claim_locked_wallet TEXT,
  created_by_wallet TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_giveaways_status ON community_giveaways(status);
CREATE INDEX IF NOT EXISTS idx_community_giveaways_winner ON community_giveaways(winner_wallet)
  WHERE winner_wallet IS NOT NULL AND claimed_at IS NULL;

CREATE TABLE IF NOT EXISTS community_giveaway_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  giveaway_id UUID NOT NULL REFERENCES community_giveaways(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  draw_weight INTEGER NOT NULL DEFAULT 1 CHECK (draw_weight >= 1 AND draw_weight <= 100),
  owl_boost_tx TEXT,
  owl_boosted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(giveaway_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_community_giveaway_entries_giveaway ON community_giveaway_entries(giveaway_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_giveaway_entries_owl_boost_tx_unique
  ON community_giveaway_entries(owl_boost_tx)
  WHERE owl_boost_tx IS NOT NULL;

CREATE TRIGGER update_community_giveaways_updated_at BEFORE UPDATE ON community_giveaways
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE community_giveaways ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_giveaway_entries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE community_giveaways IS 'Pool giveaways: entries, weighted draw, NFT claim from prize escrow; API uses service role.';
COMMENT ON TABLE community_giveaway_entries IS 'One row per wallet per giveaway; draw_weight 3 when OWL boost verified before starts_at.';
