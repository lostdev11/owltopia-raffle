-- Allow Phase B staging before a launch row exists (generator project handoff).

ALTER TABLE public.owl_center_asset_upload_jobs
  ALTER COLUMN launch_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS generator_project_id text,
  ADD COLUMN IF NOT EXISTS creator_wallet text;

ALTER TABLE public.owl_center_asset_upload_jobs DROP CONSTRAINT IF EXISTS owl_center_asset_upload_jobs_scope_check;
ALTER TABLE public.owl_center_asset_upload_jobs
  ADD CONSTRAINT owl_center_asset_upload_jobs_scope_check CHECK (
    launch_id IS NOT NULL OR (generator_project_id IS NOT NULL AND generator_project_id <> '')
  );

CREATE INDEX IF NOT EXISTS idx_owl_center_asset_upload_jobs_generator_project
  ON public.owl_center_asset_upload_jobs (generator_project_id, created_at DESC)
  WHERE generator_project_id IS NOT NULL;

COMMENT ON COLUMN public.owl_center_asset_upload_jobs.generator_project_id IS
  'GeneratorProject.id — staged before launch submit; linked on PENDING_REVIEW insert.';
