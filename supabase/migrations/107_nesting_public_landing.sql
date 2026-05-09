-- Public landing gate for /nesting (admin-controlled from Owl Nesting admin).
-- When landing_public is false, non-admins are redirected to /dashboard/nesting.

CREATE TABLE IF NOT EXISTS public.nesting_public_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  landing_public BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_wallet TEXT,
  CONSTRAINT nesting_public_settings_single_row CHECK (id = 'default')
);

INSERT INTO public.nesting_public_settings (id, landing_public, updated_at, updated_by_wallet)
VALUES ('default', FALSE, NOW(), NULL)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS update_nesting_public_settings_updated_at ON public.nesting_public_settings;
CREATE TRIGGER update_nesting_public_settings_updated_at
  BEFORE UPDATE ON public.nesting_public_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.nesting_public_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read nesting public settings" ON public.nesting_public_settings;
CREATE POLICY "Anyone can read nesting public settings"
  ON public.nesting_public_settings
  FOR SELECT
  USING (true);

COMMENT ON TABLE public.nesting_public_settings IS 'Single row (id=default). Public read; writes via service role admin API only.';
