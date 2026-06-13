-- Owl Center Phase B: staged Sugar ZIP uploads + background Arweave (Irys) jobs.

-- Private staging bucket (ZIP only — API + service role; no public read)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'owl-center-asset-staging',
  'owl-center-asset-staging',
  false,
  536870912,
  ARRAY['application/zip', 'application/x-zip-compressed', 'application/octet-stream']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.owl_center_asset_upload_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL REFERENCES owl_center_launches(id) ON DELETE CASCADE,
  staged_zip_path text NOT NULL,
  original_filename text,
  status text NOT NULL DEFAULT 'queued',
  validation_scan jsonb,
  upload_progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owl_center_asset_upload_jobs_status_check CHECK (
    status IN ('queued', 'validating', 'validated', 'uploading', 'completed', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS idx_owl_center_asset_upload_jobs_launch
  ON public.owl_center_asset_upload_jobs (launch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_owl_center_asset_upload_jobs_status
  ON public.owl_center_asset_upload_jobs (status, updated_at);

COMMENT ON TABLE public.owl_center_asset_upload_jobs IS
  'Phase B: staged Sugar ZIP → validate → batched Irys/Arweave upload. API + service_role only.';

ALTER TABLE public.owl_center_asset_upload_jobs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owl_center_asset_upload_jobs TO service_role;
