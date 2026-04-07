-- Incremental OWL boosts: +1 draw_weight per verified tx, up to +3 extra (max weight 4).
CREATE TABLE IF NOT EXISTS community_giveaway_owl_boosts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id UUID NOT NULL REFERENCES community_giveaway_entries(id) ON DELETE CASCADE,
  tx_signature TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_giveaway_owl_boosts_entry
  ON community_giveaway_owl_boosts(entry_id);

INSERT INTO community_giveaway_owl_boosts (entry_id, tx_signature)
SELECT id, owl_boost_tx
FROM community_giveaway_entries
WHERE owl_boost_tx IS NOT NULL AND trim(owl_boost_tx) != ''
ON CONFLICT (tx_signature) DO NOTHING;

DROP INDEX IF EXISTS idx_community_giveaway_entries_owl_boost_tx_unique;

ALTER TABLE community_giveaway_entries DROP COLUMN IF EXISTS owl_boost_tx;
ALTER TABLE community_giveaway_entries DROP COLUMN IF EXISTS owl_boosted_at;

COMMENT ON TABLE community_giveaway_owl_boosts IS 'Each row: one OWL payment for +1 draw_weight on parent entry (max total weight 4).';
