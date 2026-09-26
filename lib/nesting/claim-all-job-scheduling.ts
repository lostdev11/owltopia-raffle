import {
  claimAllExecutionDeadlineMs,
  shouldStopClaimAllBatchesForDeadline,
} from '@/lib/nesting/claim-all-deadline'

/** Must exceed a full claim-all tick (~285s) so a live worker keeps the lock. */
export const CLAIM_ALL_JOB_LOCK_STALE_MS = 330_000

export type ClaimAllJobSchedulingRow = {
  invocation_started_at_ms: number | null
  pending_position_ids: string[]
  attempt_count: number
  max_attempts: number
  locked_at: string | null
  lock_owner: string | null
}

export function resolveClaimAllInvocationStartedAtMs(
  job: Pick<ClaimAllJobSchedulingRow, 'invocation_started_at_ms'>,
  tickStartedAtMs?: number
): number {
  const stored = job.invocation_started_at_ms
  if (stored != null && Number.isFinite(stored) && stored > 0) return stored
  return tickStartedAtMs ?? Date.now()
}

export function isClaimAllJobLockHeldByAnotherWorker(
  job: Pick<ClaimAllJobSchedulingRow, 'locked_at' | 'lock_owner'>,
  candidateOwner: string,
  nowMs: number = Date.now(),
  staleMs: number = CLAIM_ALL_JOB_LOCK_STALE_MS
): boolean {
  if (!job.locked_at) return false
  const lockedAt = new Date(job.locked_at).getTime()
  if (!Number.isFinite(lockedAt)) return false
  if (nowMs - lockedAt >= staleMs) return false
  const owner = (job.lock_owner ?? '').trim()
  return owner.length > 0 && owner !== candidateOwner.trim()
}

/** Cron should not start a new tick when the shared invocation window is nearly exhausted. */
export function shouldSkipClaimAllJobCronTickForInvocationDeadline(
  job: Pick<ClaimAllJobSchedulingRow, 'invocation_started_at_ms'>,
  nowMs: number = Date.now()
): boolean {
  const invocationMs = job.invocation_started_at_ms
  if (invocationMs == null || !Number.isFinite(invocationMs)) return false
  const deadlineMs = claimAllExecutionDeadlineMs(invocationMs)
  return shouldStopClaimAllBatchesForDeadline(deadlineMs, nowMs)
}

export function isClaimAllJobEligibleForCronQueue(
  job: ClaimAllJobSchedulingRow,
  nowMs: number = Date.now(),
  staleMs: number = CLAIM_ALL_JOB_LOCK_STALE_MS
): boolean {
  if (job.pending_position_ids.length === 0) return false
  if (job.attempt_count >= job.max_attempts) return false
  if (shouldSkipClaimAllJobCronTickForInvocationDeadline(job, nowMs)) return false
  if (job.locked_at) {
    const lockedAt = new Date(job.locked_at).getTime()
    if (Number.isFinite(lockedAt) && nowMs - lockedAt < staleMs) return false
  }
  return true
}
