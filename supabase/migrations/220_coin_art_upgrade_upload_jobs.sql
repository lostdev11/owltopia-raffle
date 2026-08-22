-- ============================================================================
-- 220: In-app ZIP → Irys → catalog seed for Owltopia Coin art upgrades.
-- Admins stage a ZIP of {n}.png + {n}.json on Admin → Coin art upgrade
-- (same Sugar-style pairs as Owl Center Phase B). Service role only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.coin_art_upgrade_upload_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staged_zip_path TEXT NOT NULL,
  original_filename TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'validating', 'validated', 'uploading', 'seeding', 'completed', 'failed')),
  -- Validation summary + resumable Irys progress + manifest coin# → URIs.
  validation_scan JSONB,
  upload_progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_by TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coin_art_upgrade_upload_jobs_status
  ON public.coin_art_upgrade_upload_jobs (status, updated_at);

DROP TRIGGER IF EXISTS update_coin_art_upgrade_upload_jobs_updated_at
  ON public.coin_art_upgrade_upload_jobs;
CREATE TRIGGER update_coin_art_upgrade_upload_jobs_updated_at
  BEFORE UPDATE ON public.coin_art_upgrade_upload_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.coin_art_upgrade_upload_jobs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coin_art_upgrade_upload_jobs TO service_role;

COMMENT ON TABLE public.coin_art_upgrade_upload_jobs IS
  'Admin ZIP staging → Irys upload → coin_art_upgrade_catalog seed for Owltopia Coin art upgrades.';
