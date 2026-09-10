-- DB-backed Partner Spotlight brands so Discord/admin retire can hide logos without a deploy.
-- Static /public/partners assets remain; this table controls which brands are shown.

CREATE TABLE IF NOT EXISTS partner_spotlight_brands (
  slug TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  logo_src TEXT NOT NULL,
  logo_alt TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  discord_partner_tenant_id UUID REFERENCES public.discord_giveaway_partner_tenants (id) ON DELETE SET NULL,
  match_aliases TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS partner_spotlight_brands_active_sort_idx
  ON partner_spotlight_brands (is_active, sort_order)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS partner_spotlight_brands_tenant_idx
  ON partner_spotlight_brands (discord_partner_tenant_id)
  WHERE discord_partner_tenant_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_partner_spotlight_brands_updated_at ON partner_spotlight_brands;
CREATE TRIGGER update_partner_spotlight_brands_updated_at
  BEFORE UPDATE ON partner_spotlight_brands
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE partner_spotlight_brands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read active partner spotlight brands" ON partner_spotlight_brands;
CREATE POLICY "Anyone can read active partner spotlight brands"
  ON partner_spotlight_brands
  FOR SELECT
  USING (is_active = true);

COMMENT ON TABLE partner_spotlight_brands IS
  'Partner Spotlight marquee brands. Soft-deactivate via Discord retire / Owl Vision suspend instead of redeploying hardcoded logos.';

-- Seed current static brands (Gearhead / Shonen Sol / Eapes already removed from code).
INSERT INTO partner_spotlight_brands (slug, display_name, logo_src, logo_alt, sort_order, is_active, match_aliases)
VALUES
  ('sharkyfi', 'SharkyFi', '/partners/sharkyfi-logo.png', 'SharkyFi partner logo', 10, true, ARRAY['sharky', 'sharkyfi']),
  ('jester-owl', 'Jester Owl', '/partners/jester-owl-logo.png', 'Jester Owl partner logo', 20, true, ARRAY['jester', 'jester owl']),
  ('smile', 'Smile QR', '/partners/smile-logo.png', 'Smile QR partner logo', 30, true, ARRAY['smile', 'smile qr']),
  ('fuddy', 'Fuddy', '/partners/fuddy-logo.png', 'Fuddy partner logo', 40, true, ARRAY['fuddy', 'fuddy dogs']),
  ('panda', 'Roaring Panda', '/partners/panda-partner.png', 'Roaring Panda partner logo', 50, true, ARRAY['panda', 'roaring panda', 'panda partner']),
  ('partner-community-mark', 'Partner Community', '/partners/partner-community-mark.png', 'Partner community logo', 60, true, ARRAY['partner community']),
  ('ugly-ape-squad', 'Ugly Ape Squad', '/partners/ugly-ape-squad-logo.png', 'Ugly Ape Squad partner logo', 70, true, ARRAY['ugly ape squad', 'uas']),
  ('ugly-mutant-ape-squad', 'Ugly Mutant Ape Squad', '/partners/ugly-mutant-ape-squad-logo.png', 'Ugly Mutant Ape Squad partner logo', 80, true, ARRAY['ugly mutant ape', 'mutant ape squad']),
  ('shaolin-saga', 'Shaolin Saga', '/partners/shaolin-saga-logo.png', 'Shaolin Saga partner logo', 90, true, ARRAY['shaolin', 'shaolin saga']),
  ('lesharx', 'LeSharx', '/partners/lesharx-logo.png', 'LeSharx partner logo', 100, true, ARRAY['lesharx', 'le sharx']),
  ('the-misfits-order', 'The Misfits Order', '/partners/the-misfits-order-logo.png', 'The Misfits Order partner logo', 110, true, ARRAY['misfits', 'the misfits order', 'mis fits order'])
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  logo_src = EXCLUDED.logo_src,
  logo_alt = EXCLUDED.logo_alt,
  sort_order = EXCLUDED.sort_order,
  match_aliases = EXCLUDED.match_aliases,
  updated_at = NOW();
