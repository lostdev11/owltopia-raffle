-- Per-launch deploy lease for server-side Core Candy Machine deploy (prevents overlapping creates).

ALTER TABLE public.owl_center_asset_upload_jobs
  ADD COLUMN IF NOT EXISTS deploy_lock_until timestamptz;

COMMENT ON COLUMN public.owl_center_asset_upload_jobs.deploy_lock_until IS
  'Exclusive lease while Phase B on-chain Core CM deploy runs on the server. NULL = idle.';

CREATE INDEX IF NOT EXISTS idx_owl_center_asset_upload_jobs_deploy_lock
  ON public.owl_center_asset_upload_jobs (deploy_lock_until)
  WHERE deploy_lock_until IS NOT NULL;
