-- Owl Packs launch mode (public | restricted) + test-wallet allowlist.
-- Restricted: admins + pack_test_wallets. Public: everyone.
-- Purchases still gated by pack_vault_config.paused.
-- Env PACKS_PUBLIC=false remains an emergency kill switch (admins only).

CREATE TABLE IF NOT EXISTS public.pack_public_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  access_mode TEXT NOT NULL DEFAULT 'restricted'
    CHECK (access_mode IN ('public', 'restricted')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_wallet TEXT,
  CONSTRAINT pack_public_settings_single_row CHECK (id = 'default')
);

INSERT INTO public.pack_public_settings (id, access_mode, updated_at, updated_by_wallet)
VALUES ('default', 'restricted', NOW(), NULL)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS update_pack_public_settings_updated_at ON public.pack_public_settings;
CREATE TRIGGER update_pack_public_settings_updated_at
  BEFORE UPDATE ON public.pack_public_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.pack_public_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read pack public settings" ON public.pack_public_settings;
CREATE POLICY "Anyone can read pack public settings"
  ON public.pack_public_settings
  FOR SELECT
  USING (true);

GRANT SELECT ON public.pack_public_settings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pack_public_settings TO service_role;

COMMENT ON TABLE public.pack_public_settings IS
  'Single row (id=default). access_mode public|restricted. Public read; writes via service role admin API.';

CREATE TABLE IF NOT EXISTS public.pack_test_wallets (
  wallet_address text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_wallet text,
  note text
);

CREATE INDEX IF NOT EXISTS idx_pack_test_wallets_created_at
  ON public.pack_test_wallets (created_at DESC);

COMMENT ON TABLE public.pack_test_wallets IS
  'Wallets allowed to use Owl Packs when access_mode=restricted; managed by full admins via Admin → Packs.';

ALTER TABLE public.pack_test_wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all pack_test_wallets" ON public.pack_test_wallets;
CREATE POLICY "Deny all pack_test_wallets"
  ON public.pack_test_wallets
  FOR ALL
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON public.pack_test_wallets FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pack_test_wallets TO service_role;
