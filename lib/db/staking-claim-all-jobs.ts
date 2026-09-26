import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  CLAIM_ALL_JOB_LOCK_STALE_MS,
  isClaimAllJobEligibleForCronQueue,
} from '@/lib/nesting/claim-all-job-scheduling'

export type StakingClaimAllJobStatus = 'processing' | 'completed' | 'failed'

export type StakingClaimAllJobRow = {
  id: string
  wallet_address: string
  platform_fee_signature: string
  pool_id: string
  status: StakingClaimAllJobStatus
  pending_position_ids: string[]
  completed_position_ids: string[]
  fee_units: number
  claim_all_eligibility_token: string | null
  total_claimed_ui: number
  batches_completed: number
  batch_count_estimate: number | null
  attempt_count: number
  max_attempts: number
  last_error: string | null
  lock_owner: string | null
  locked_at: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  invocation_started_at_ms: number | null
}

function mapRow(data: Record<string, unknown>): StakingClaimAllJobRow {
  return {
    id: String(data.id),
    wallet_address: String(data.wallet_address),
    platform_fee_signature: String(data.platform_fee_signature),
    pool_id: String(data.pool_id),
    status: data.status as StakingClaimAllJobStatus,
    pending_position_ids: Array.isArray(data.pending_position_ids)
      ? data.pending_position_ids.map(String)
      : [],
    completed_position_ids: Array.isArray(data.completed_position_ids)
      ? data.completed_position_ids.map(String)
      : [],
    fee_units: Number(data.fee_units),
    claim_all_eligibility_token:
      typeof data.claim_all_eligibility_token === 'string'
        ? data.claim_all_eligibility_token
        : null,
    total_claimed_ui: Number(data.total_claimed_ui ?? 0),
    batches_completed: Number(data.batches_completed ?? 0),
    batch_count_estimate:
      data.batch_count_estimate != null ? Number(data.batch_count_estimate) : null,
    attempt_count: Number(data.attempt_count ?? 0),
    max_attempts: Number(data.max_attempts ?? 48),
    last_error: typeof data.last_error === 'string' ? data.last_error : null,
    lock_owner: typeof data.lock_owner === 'string' ? data.lock_owner : null,
    locked_at: typeof data.locked_at === 'string' ? data.locked_at : null,
    created_at: String(data.created_at),
    updated_at: String(data.updated_at),
    completed_at: typeof data.completed_at === 'string' ? data.completed_at : null,
    invocation_started_at_ms:
      data.invocation_started_at_ms != null && data.invocation_started_at_ms !== ''
        ? Number(data.invocation_started_at_ms)
        : null,
  }
}

export async function getActiveClaimAllJobForWallet(
  wallet: string
): Promise<StakingClaimAllJobRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('staking_claim_all_jobs')
    .select('*')
    .eq('wallet_address', wallet.trim())
    .eq('status', 'processing')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapRow(data as Record<string, unknown>) : null
}

export async function getClaimAllJobById(jobId: string): Promise<StakingClaimAllJobRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('staking_claim_all_jobs')
    .select('*')
    .eq('id', jobId.trim())
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapRow(data as Record<string, unknown>) : null
}

export async function insertClaimAllJob(row: {
  wallet_address: string
  platform_fee_signature: string
  pool_id: string
  pending_position_ids: string[]
  fee_units: number
  claim_all_eligibility_token?: string | null
  batch_count_estimate?: number | null
}): Promise<StakingClaimAllJobRow> {
  const { data, error } = await getSupabaseAdmin()
    .from('staking_claim_all_jobs')
    .insert({
      wallet_address: row.wallet_address.trim(),
      platform_fee_signature: row.platform_fee_signature.trim(),
      pool_id: row.pool_id,
      pending_position_ids: row.pending_position_ids,
      fee_units: row.fee_units,
      claim_all_eligibility_token: row.claim_all_eligibility_token ?? null,
      batch_count_estimate: row.batch_count_estimate ?? null,
      status: 'processing',
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return mapRow(data as Record<string, unknown>)
}

export async function tryLockClaimAllJob(
  jobId: string,
  owner: string,
  staleSeconds = Math.ceil(CLAIM_ALL_JOB_LOCK_STALE_MS / 1000)
): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc('staking_claim_all_job_try_lock', {
    p_job_id: jobId,
    p_owner: owner,
    p_stale_seconds: staleSeconds,
  })
  if (error) throw new Error(error.message)
  return data === true
}

export async function heartbeatClaimAllJobLock(jobId: string, owner: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc('staking_claim_all_job_heartbeat_lock', {
    p_job_id: jobId,
    p_owner: owner,
  })
  if (error) throw new Error(error.message)
  return data === true
}

export async function releaseClaimAllJobLock(jobId: string, owner: string): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc('staking_claim_all_job_release_lock', {
    p_job_id: jobId,
    p_owner: owner,
  })
  if (error) throw new Error(error.message)
}

export async function updateClaimAllJobProgress(
  jobId: string,
  patch: {
    pending_position_ids?: string[]
    completed_position_ids?: string[]
    total_claimed_ui?: number
    batches_completed?: number
    batch_count_estimate?: number | null
    attempt_count?: number
    last_error?: string | null
    status?: StakingClaimAllJobStatus
    completed_at?: string | null
    invocation_started_at_ms?: number | null
  }
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('staking_claim_all_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId)
  if (error) throw new Error(error.message)
}

export async function listClaimAllJobsDueForCron(limit: number): Promise<StakingClaimAllJobRow[]> {
  const cap = Math.min(20, Math.max(1, limit))
  const { data, error } = await getSupabaseAdmin()
    .from('staking_claim_all_jobs')
    .select('*')
    .eq('status', 'processing')
    .order('updated_at', { ascending: true })
    .limit(cap * 3)
  if (error) throw new Error(error.message)

  const rows = (data ?? []).map((d) => mapRow(d as Record<string, unknown>))
  const due: StakingClaimAllJobRow[] = []
  const now = Date.now()
  for (const row of rows) {
    if (!isClaimAllJobEligibleForCronQueue(row, now, CLAIM_ALL_JOB_LOCK_STALE_MS)) continue
    due.push(row)
    if (due.length >= cap) break
  }
  return due
}

export async function listRecentFailedClaimAllJobs(limit = 20): Promise<StakingClaimAllJobRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('staking_claim_all_jobs')
    .select('*')
    .eq('status', 'failed')
    .order('updated_at', { ascending: false })
    .limit(Math.min(50, Math.max(1, limit)))
  if (error) throw new Error(error.message)
  return (data ?? []).map((d) => mapRow(d as Record<string, unknown>))
}
