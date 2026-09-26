-- Background Claim-all jobs: fee reserved once, OWL batches continue via cron / after() without the browser.

CREATE TABLE IF NOT EXISTS public.staking_claim_all_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  platform_fee_signature TEXT NOT NULL,
  pool_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  pending_position_ids UUID[] NOT NULL DEFAULT '{}',
  completed_position_ids UUID[] NOT NULL DEFAULT '{}',
  fee_units INT NOT NULL,
  claim_all_eligibility_token TEXT,
  total_claimed_ui NUMERIC NOT NULL DEFAULT 0,
  batches_completed INT NOT NULL DEFAULT 0,
  batch_count_estimate INT,
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 48,
  last_error TEXT,
  lock_owner TEXT,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

COMMENT ON TABLE public.staking_claim_all_jobs IS
  'Server-driven Claim all after platform fee is reserved. Cron and HTTP workers acquire a row lock before sending OWL batches.';

CREATE INDEX IF NOT EXISTS idx_staking_claim_all_jobs_wallet_status
  ON public.staking_claim_all_jobs (wallet_address, status);

CREATE INDEX IF NOT EXISTS idx_staking_claim_all_jobs_processing_updated
  ON public.staking_claim_all_jobs (updated_at)
  WHERE status = 'processing';

CREATE UNIQUE INDEX IF NOT EXISTS idx_staking_claim_all_jobs_one_processing_per_wallet
  ON public.staking_claim_all_jobs (wallet_address)
  WHERE status = 'processing';

ALTER TABLE public.staking_claim_all_jobs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staking_claim_all_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.staking_claim_all_job_try_lock(
  p_job_id UUID,
  p_owner TEXT,
  p_stale_seconds INT DEFAULT 180
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
BEGIN
  IF p_job_id IS NULL OR btrim(COALESCE(p_owner, '')) = '' THEN
    RETURN FALSE;
  END IF;

  UPDATE public.staking_claim_all_jobs
  SET locked_at = now(),
      lock_owner = btrim(p_owner),
      updated_at = now()
  WHERE id = p_job_id
    AND status = 'processing'
    AND cardinality(pending_position_ids) > 0
    AND attempt_count < max_attempts
    AND (
      locked_at IS NULL
      OR locked_at < now() - make_interval(secs => GREATEST(30, COALESCE(p_stale_seconds, 180)))
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.staking_claim_all_job_release_lock(
  p_job_id UUID,
  p_owner TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.staking_claim_all_jobs
  SET locked_at = NULL,
      lock_owner = NULL,
      updated_at = now()
  WHERE id = p_job_id
    AND status = 'processing'
    AND (lock_owner IS NULL OR lock_owner = btrim(COALESCE(p_owner, '')));
END;
$$;

GRANT EXECUTE ON FUNCTION public.staking_claim_all_job_try_lock(UUID, TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.staking_claim_all_job_release_lock(UUID, TEXT) TO service_role;
