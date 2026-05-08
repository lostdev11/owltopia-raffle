-- Add explicit partner tier management on allowlisted creator wallets.

ALTER TABLE partner_community_creators
  ADD COLUMN IF NOT EXISTS partner_tier TEXT NOT NULL DEFAULT '$0_partner';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'partner_community_creators_partner_tier_check'
  ) THEN
    ALTER TABLE partner_community_creators
      ADD CONSTRAINT partner_community_creators_partner_tier_check
      CHECK (partner_tier IN ('$0_partner', 'partner_pro', 'white_label'));
  END IF;
END $$;

COMMENT ON COLUMN partner_community_creators.partner_tier IS
  'Commercial tier for this partner wallet: $0_partner, partner_pro, or white_label.';
