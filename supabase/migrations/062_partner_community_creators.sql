-- Partner community creators: reduced platform fee (2%) and public spotlight eligibility.
-- One wallet per partner project. Managed via SQL or admin tooling (writes use service role).

CREATE TABLE IF NOT EXISTS partner_community_creators (
  creator_wallet TEXT PRIMARY KEY,
  display_label TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS partner_community_creators_active_sort_idx
  ON partner_community_creators (is_active, sort_order)
  WHERE is_active = true;

INSERT INTO partner_community_creators (creator_wallet, display_label, sort_order, is_active)
VALUES ('bopM2ojpoQXeBxr9MccTKpXXTFaMg6Um9LQe2ozDPVi', NULL, 0, true)
ON CONFLICT (creator_wallet) DO UPDATE SET
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

DROP TRIGGER IF EXISTS update_partner_community_creators_updated_at ON partner_community_creators;
CREATE TRIGGER update_partner_community_creators_updated_at
  BEFORE UPDATE ON partner_community_creators
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE partner_community_creators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read active partner community creators" ON partner_community_creators;
CREATE POLICY "Anyone can read active partner community creators"
  ON partner_community_creators
  FOR SELECT
  USING (is_active = true);

COMMENT ON TABLE partner_community_creators IS 'Allowlisted creator wallets for 2% partner fee tier and /raffles partner spotlight.';
