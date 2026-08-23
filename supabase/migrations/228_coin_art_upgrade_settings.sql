-- Admin toggle: coin art upgrades on Nesting without redeploying Vercel env.

CREATE TABLE IF NOT EXISTS public.coin_art_upgrade_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  upgrades_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_wallet TEXT,
  CONSTRAINT coin_art_upgrade_settings_single_row CHECK (id = 'default')
);

INSERT INTO public.coin_art_upgrade_settings (id, upgrades_enabled, updated_at, updated_by_wallet)
VALUES ('default', FALSE, NOW(), NULL)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS update_coin_art_upgrade_settings_updated_at ON public.coin_art_upgrade_settings;
CREATE TRIGGER update_coin_art_upgrade_settings_updated_at
  BEFORE UPDATE ON public.coin_art_upgrade_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.coin_art_upgrade_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read coin art upgrade settings" ON public.coin_art_upgrade_settings;
CREATE POLICY "Anyone can read coin art upgrade settings"
  ON public.coin_art_upgrade_settings
  FOR SELECT
  USING (true);

GRANT SELECT ON public.coin_art_upgrade_settings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coin_art_upgrade_settings TO service_role;

COMMENT ON TABLE public.coin_art_upgrade_settings IS
  'Single row (id=default). Admin toggle for coin art upgrades. COIN_ART_UPGRADE_ENABLED env still overrides.';
