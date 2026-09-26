import { appendStakingPlatformFeePositionIds } from '@/lib/db/staking-platform-fee-payments'
import { getStakingPoolById } from '@/lib/db/staking-pools'
import {
  getActiveClaimAllJobForWallet,
  getClaimAllJobById,
  insertClaimAllJob,
  listClaimAllJobsDueForCron,
  releaseClaimAllJobLock,
  tryLockClaimAllJob,
  updateClaimAllJobProgress,
  type StakingClaimAllJobRow,
} from '@/lib/db/staking-claim-all-jobs'
import { claimAllExecutionDeadlineMs } from '@/lib/nesting/claim-all-deadline'
import { verifyClaimAllEligibilityToken } from '@/lib/nesting/claim-all-eligibility'
import { executeChunkedBatchOwlClaims } from '@/lib/nesting/chunked-claim-all'
import { isStakingUserError, StakingUserError } from '@/lib/nesting/errors'
import { getClaimAllBatchSize } from '@/lib/nesting/policy'

export type ClaimAllJobPublicView = {
  job_id: string
  wallet_address?: string
  status: StakingClaimAllJobRow['status']
  claim_all_complete: boolean
  total_claimed: number
  pending_nest_count: number
  completed_nest_count: number
  batches_completed: number
  batch_count_estimate: number | null
  last_error: string | null
  updated_at: string
}

export function claimAllJobToPublicView(job: StakingClaimAllJobRow): ClaimAllJobPublicView {
  return {
    job_id: job.id,
    status: job.status,
    claim_all_complete: job.status === 'completed' || job.pending_position_ids.length === 0,
    total_claimed: job.total_claimed_ui,
    pending_nest_count: job.pending_position_ids.length,
    completed_nest_count: job.completed_position_ids.length,
    batches_completed: job.batches_completed,
    batch_count_estimate: job.batch_count_estimate,
    last_error: job.last_error,
    updated_at: job.updated_at,
    wallet_address: job.wallet_address,
  }
}

function estimateBatchCount(nestCount: number): number {
  const size = getClaimAllBatchSize()
  return Math.max(1, Math.ceil(nestCount / size))
}

export async function scheduleClaimAllJobContinuation(jobId: string): Promise<void> {
  const { after } = await import('next/server')
  after(async () => {
    await runClaimAllJobTick({ jobId, lockOwner: 'after' }).catch((e) => {
      console.warn('[claim-all-job] after() tick failed', jobId, e instanceof Error ? e.message : e)
    })
  })
}

export async function processClaimAllJobsCron(limit = 5): Promise<{
  scanned: number
  ticked: number
  completed: number
  errors: string[]
}> {
  const jobs = await listClaimAllJobsDueForCron(limit)
  let ticked = 0
  let completed = 0
  const errors: string[] = []
  for (const job of jobs) {
    try {
      const result = await runClaimAllJobTick({ jobId: job.id, lockOwner: 'cron' })
      ticked += 1
      if (result.claim_all_complete) completed += 1
    } catch (e) {
      errors.push(`${job.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { scanned: jobs.length, ticked, completed, errors }
}

export type ClaimAllJobTickResult = ClaimAllJobPublicView & {
  claims: Array<{
    position_id: string
    claimed: number
    claimed_rewards_total: number
  }>
  transaction_signature: string | null
  transaction_signatures: string[]
  execution_path: 'onchain_transfer' | 'database_only'
  skipped_lock_count?: number
  skipped_owl?: number
  skipped_locks?: Array<{ position_id: string; asset_id: string | null; reason: string }>
}

export async function runClaimAllJobTick(params: {
  jobId: string
  lockOwner: string
  startedAtMs?: number
}): Promise<ClaimAllJobTickResult> {
  const jobId = params.jobId.trim()
  const lockOwner = params.lockOwner.trim()
  if (!jobId || !lockOwner) {
    throw new StakingUserError('Claim-all job id missing.', 500)
  }

  const acquired = await tryLockClaimAllJob(jobId, lockOwner)
  if (!acquired) {
    const job = await getClaimAllJobById(jobId)
    if (!job) throw new StakingUserError('Claim-all job not found.', 404)
    return {
      ...claimAllJobToPublicView(job),
      claims: [],
      transaction_signature: null,
      transaction_signatures: [],
      execution_path: 'database_only',
    }
  }

  try {
    let job = await getClaimAllJobById(jobId)
    if (!job) throw new StakingUserError('Claim-all job not found.', 404)
    if (job.status !== 'processing') {
      return {
        ...claimAllJobToPublicView(job),
        claims: [],
        transaction_signature: null,
        transaction_signatures: [],
        execution_path: 'database_only',
      }
    }

    const nextAttempt = job.attempt_count + 1
    if (nextAttempt > job.max_attempts) {
      await updateClaimAllJobProgress(jobId, {
        status: 'failed',
        last_error: `Exceeded max attempts (${job.max_attempts}).`,
        attempt_count: nextAttempt,
        completed_at: new Date().toISOString(),
      })
      job = (await getClaimAllJobById(jobId))!
      return {
        ...claimAllJobToPublicView(job),
        claims: [],
        transaction_signature: null,
        transaction_signatures: [],
        execution_path: 'database_only',
      }
    }

    await updateClaimAllJobProgress(jobId, { attempt_count: nextAttempt, last_error: null })

    const eligibility = job.claim_all_eligibility_token
      ? verifyClaimAllEligibilityToken(job.claim_all_eligibility_token, job.wallet_address)
      : null

    const { prepareClaimAllExecution } = await import('@/lib/nesting/service')
    const prepared = await prepareClaimAllExecution(job.wallet_address, {
      skipLockVerify: Boolean(eligibility),
      eligiblePositionIds: eligibility?.p ?? job.pending_position_ids,
    })

    const pendingSet = new Set(job.pending_position_ids.map((id) => id.trim()))
    const claimPlans = prepared.claimPlans.filter((p) => pendingSet.has(p.positionId))

    if (claimPlans.length === 0) {
      await updateClaimAllJobProgress(jobId, {
        status: 'completed',
        pending_position_ids: [],
        completed_at: new Date().toISOString(),
      })
      job = (await getClaimAllJobById(jobId))!
      return {
        ...claimAllJobToPublicView(job),
        claims: [],
        transaction_signature: null,
        transaction_signatures: [],
        execution_path: 'database_only',
        skipped_lock_count: prepared.skippedLocks.length,
        skipped_owl: prepared.skippedOwlPreview,
      }
    }

    const pool = await getStakingPoolById(job.pool_id)
    if (!pool) {
      throw new StakingUserError('Pool not found for Claim-all job.', 400)
    }

    const feeSignature = job.platform_fee_signature.trim()
    const linkFeeOnBatch = feeSignature && feeSignature !== 'no_platform_fee'
    const deadlineMs = claimAllExecutionDeadlineMs(params.startedAtMs ?? Date.now())
    const tickClaims: ClaimAllJobTickResult['claims'] = []
    let tickTotal = 0
    let tickSigs: string[] = []
    let executionPath: 'onchain_transfer' | 'database_only' = 'database_only'
    let batchesThisTick = 0

    try {
      const result = await executeChunkedBatchOwlClaims({
        wallet: job.wallet_address,
        pool,
        plans: claimPlans,
        deadlineMs,
        onBatchCompleted: linkFeeOnBatch
          ? async (positionIds) => {
              await appendStakingPlatformFeePositionIds(feeSignature, positionIds)
              batchesThisTick += 1
            }
          : undefined,
      })
      tickTotal = result.total_claimed
      tickClaims.push(...result.claims)
      tickSigs = result.transaction_signatures
      executionPath = result.execution_path
      batchesThisTick = result.batch_count

      const completedIds = [
        ...new Set([...job.completed_position_ids, ...result.claims.map((c) => c.position_id)]),
      ]
      const doneSet = new Set(completedIds)
      const stillPending = job.pending_position_ids.filter((id) => !doneSet.has(id))

      await updateClaimAllJobProgress(jobId, {
        pending_position_ids: stillPending,
        completed_position_ids: completedIds,
        total_claimed_ui: job.total_claimed_ui + tickTotal,
        batches_completed: job.batches_completed + batchesThisTick,
        batch_count_estimate: job.batch_count_estimate ?? estimateBatchCount(completedIds.length + stillPending.length),
        status: stillPending.length === 0 ? 'completed' : 'processing',
        completed_at: stillPending.length === 0 ? new Date().toISOString() : null,
      })

      job = (await getClaimAllJobById(jobId))!
      const view = claimAllJobToPublicView(job)
      if (!view.claim_all_complete) {
        await scheduleClaimAllJobContinuation(jobId)
      }
      return {
        ...view,
        claims: tickClaims,
        transaction_signature: result.transaction_signature,
        transaction_signatures: tickSigs,
        execution_path: executionPath,
        skipped_lock_count: prepared.skippedLocks.length,
        skipped_owl: prepared.skippedOwlPreview,
        skipped_locks: prepared.skippedLocks.map((s) => ({
          position_id: s.positionId,
          asset_id: s.assetId,
          reason: s.message,
        })),
      }
    } catch (e) {
      if (isStakingUserError(e) && e.extra?.code === 'claim_all_partial_batch') {
        const batchClaims = Array.isArray(e.extra.claims) ? e.extra.claims : []
        const completedFromError = batchClaims
          .map((c) => (c && typeof c === 'object' && 'position_id' in c ? String((c as { position_id: string }).position_id) : ''))
          .filter(Boolean)
        const completedIds = [...new Set([...job.completed_position_ids, ...completedFromError])]
        const doneSet = new Set(completedIds)
        const stillPending = job.pending_position_ids.filter((id) => !doneSet.has(id))
        const newClaimedUi = batchClaims.reduce(
          (sum, c) => sum + (typeof c.claimed === 'number' && Number.isFinite(c.claimed) ? c.claimed : 0),
          0
        )
        const batchesDone =
          typeof e.extra.batches_completed === 'number'
            ? Number(e.extra.batches_completed)
            : job.batches_completed + batchesThisTick

        await updateClaimAllJobProgress(jobId, {
          pending_position_ids: stillPending,
          completed_position_ids: completedIds,
          total_claimed_ui: job.total_claimed_ui + newClaimedUi,
          batches_completed: Math.max(job.batches_completed, batchesDone),
          batch_count_estimate:
            typeof e.extra.batch_count === 'number'
              ? Number(e.extra.batch_count)
              : job.batch_count_estimate,
          last_error: null,
        })

        await scheduleClaimAllJobContinuation(jobId)
        job = (await getClaimAllJobById(jobId))!
        return {
          ...claimAllJobToPublicView(job),
          claims: batchClaims as ClaimAllJobTickResult['claims'],
          transaction_signature: null,
          transaction_signatures: Array.isArray(e.extra.transaction_signatures)
            ? e.extra.transaction_signatures.filter((s): s is string => typeof s === 'string')
            : [],
          execution_path: 'onchain_transfer',
          skipped_lock_count: prepared.skippedLocks.length,
          skipped_owl: prepared.skippedOwlPreview,
        }
      }

      const errText = e instanceof Error ? e.message : String(e)
      await updateClaimAllJobProgress(jobId, { last_error: errText.slice(0, 500) })
      if (isStakingUserError(e) && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
        await updateClaimAllJobProgress(jobId, {
          status: 'failed',
          completed_at: new Date().toISOString(),
        })
      } else if (nextAttempt >= job.max_attempts) {
        await updateClaimAllJobProgress(jobId, {
          status: 'failed',
          completed_at: new Date().toISOString(),
        })
      } else {
        await scheduleClaimAllJobContinuation(jobId)
      }
      throw e
    }
  } finally {
    await releaseClaimAllJobLock(jobId, lockOwner).catch(() => {})
  }
}

export async function ensureClaimAllJob(params: {
  wallet: string
  platform_fee_signature: string
  pool_id: string
  pending_position_ids: string[]
  fee_units: number
  claim_all_eligibility_token?: string | null
}): Promise<StakingClaimAllJobRow> {
  const existing = await getActiveClaimAllJobForWallet(params.wallet)
  if (existing) {
    if (existing.platform_fee_signature.trim() !== params.platform_fee_signature.trim()) {
      throw new StakingUserError(
        'A Claim all is already running for your wallet with a different platform fee. Wait for it to finish or contact support.',
        409,
        { code: 'claim_all_job_in_progress', job_id: existing.id }
      )
    }
    return existing
  }
  return insertClaimAllJob({
    wallet_address: params.wallet,
    platform_fee_signature: params.platform_fee_signature,
    pool_id: params.pool_id,
    pending_position_ids: params.pending_position_ids,
    fee_units: params.fee_units,
    claim_all_eligibility_token: params.claim_all_eligibility_token,
    batch_count_estimate: estimateBatchCount(params.pending_position_ids.length),
  })
}
