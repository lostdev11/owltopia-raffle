-- ============================================================================
-- 219: Server-managed hot key for Owltopia Coin art upgrades (Option A).
-- Generated from Admin → Coin art upgrade (no CLI). Service role only —
-- never exposed to anon/authenticated. Env COIN_ART_UPGRADE_AUTHORITY_*
-- still overrides when set (Vercel secret takes precedence).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.coin_art_upgrade_authority (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  wallet_address TEXT NOT NULL,
  -- JSON byte-array secret (same format as other nesting key envs).
  secret_key TEXT NOT NULL,
  created_by TEXT,
  rotated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_coin_art_upgrade_authority_updated_at ON public.coin_art_upgrade_authority;
CREATE TRIGGER update_coin_art_upgrade_authority_updated_at
  BEFORE UPDATE ON public.coin_art_upgrade_authority
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.coin_art_upgrade_authority ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coin_art_upgrade_authority TO service_role;

COMMENT ON TABLE public.coin_art_upgrade_authority IS
  'Singleton MPL Core UpdateDelegate hot key for coin art URI updates; admin-generated, service role only.';
