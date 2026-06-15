-- Partner Pro catalog monthly is US $50 for new subscriptions; grandfather prior partners at US $20/mo for Discord USDC renewals when linked to a partner row.

ALTER TABLE public.partner_community_creators
  ADD COLUMN IF NOT EXISTS partner_pro_monthly_quote_usdc INTEGER;

ALTER TABLE public.partner_community_creators
  DROP CONSTRAINT IF EXISTS partner_community_creators_partner_pro_monthly_quote_usdc_check;

ALTER TABLE public.partner_community_creators
  ADD CONSTRAINT partner_community_creators_partner_pro_monthly_quote_usdc_check
  CHECK (partner_pro_monthly_quote_usdc IS NULL OR (partner_pro_monthly_quote_usdc >= 1 AND partner_pro_monthly_quote_usdc <= 500));

COMMENT ON COLUMN public.partner_community_creators.partner_pro_monthly_quote_usdc IS
  'Optional Discord Partner Pro renewal amount in whole USDC for /owltopia-partner subscribe when this row links discord_partner_tenant_id; NULL means catalog standard (DISCORD_PARTNER_USDC_PRICE).';

-- Grandfather existing active partner allowlist wallets at $20/mo (Partner Pro today or $0 Partner upgrading later).
UPDATE public.partner_community_creators
SET partner_pro_monthly_quote_usdc = 20
WHERE is_active = TRUE
  AND partner_tier IN ('partner_pro', '$0_partner')
  AND partner_pro_monthly_quote_usdc IS NULL;
