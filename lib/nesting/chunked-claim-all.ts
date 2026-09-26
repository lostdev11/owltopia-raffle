import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { executeBatchOwlClaims, type BatchOwlClaimResult } from '@/lib/nesting/batch-claim'
import { isBatchClaimLedgerSyncError } from '@/lib/nesting/batch-claim-errors'
import type { PositionClaimPlan } from '@/lib/nesting/claim-plan'
import { shouldStopClaimAllBatchesForDeadline } from '@/lib/nesting/claim-all-deadline'
import { splitClaimAllPlansIntoPayableBatches } from '@/lib/nesting/claim-all-batch-planning'
import { getClaimAllBatchSize } from '@/lib/nesting/policy'
import { isStakingUserError, StakingUserError } from '@/lib/nesting/errors'
import { meetsMinOwlClaimThreshold } from '@/lib/staking/rewards'

export type ClaimAllSkippedBelowMinimum = {
  position_id: string
  pending_owl: number
}

export type ChunkedBatchOwlClaimResult = BatchOwlClaimResult & {
  batch_count: number
  transaction_signatures: string[]
  skipped_below_minimum: ClaimAllSkippedBelowMinimum[]
}

function sumPayout(plans: PositionClaimPlan[]): number {
  return plans.reduce((sum, p) => sum + p.payoutAmount, 0)
}

function shouldRetryFailedClaimBatch(e: unknown): boolean {
  // OWL may already have left the treasury — never re-send.
  if (isBatchClaimLedgerSyncError(e)) return false
  if (isStakingUserError(e)) {
    const code = typeof e.extra?.code === 'string' ? e.extra.code : ''
    if (code === 'owl_reward_transfer_unreconciled' || code === 'owl_reward_transfer_in_flight') {
      return false
    }
    // Validation / policy errors will not recover on retry.
    if (e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
      return false
    }
  }
  return true
}

/**
 * Runs Claim all in server-side batches so large wallets stay within RPC/time limits.
 * Platform fee should be validated before and committed only after every batch succeeds.
 */
function throwClaimAllPartialBatch(params: {
  batchesCompleted: number
  batchCount: number
  totalClaimed: number
  transactionSignatures: string[]
  claims: BatchOwlClaimResult['claims']
}): never {
  throw new StakingUserError(
    `OWL was sent for ${params.batchesCompleted} of ${params.batchCount} batches (${params.totalClaimed.toLocaleString(undefined, { maximumFractionDigits: 6 })} OWL total). Refresh your wallet and dashboard — Claim all again only for remaining nests; your prior platform fee can be reused if the app still has it. Contact support if any nests still show claimable OWL after a successful payout.`,
    503,
    {
      code: 'claim_all_partial_batch',
      batches_completed: params.batchesCompleted,
      batch_count: params.batchCount,
      total_claimed: params.totalClaimed,
      transaction_signatures: params.transactionSignatures,
      completed_position_ids: params.claims.map((c) => c.position_id),
      claims: params.claims,
    }
  )
}

export async function executeChunkedBatchOwlClaims(params: {
  wallet: string
  pool: StakingPoolRow
  plans: PositionClaimPlan[]
  /** When set, stop before the next batch if the route is near maxDuration. */
  deadlineMs?: number
  /** Called before each batch (lock heartbeat). Throw to abort without sending OWL. */
  onBeforeBatch?: () => Promise<void>
  /** Re-read pending amounts from DB so stale plans cannot double-pay. */
  refreshBatchPlans?: (plans: PositionClaimPlan[]) => Promise<PositionClaimPlan[]>
  /** Called after each successful batch with that batch's nest ids (fee linking). */
  onBatchCompleted?: (positionIds: string[]) => Promise<void>
  /** Fee linkage for dust nests skipped because the batch would be under 1 OWL. */
  onSkippedBelowMinimum?: (positionIds: string[]) => Promise<void>
}): Promise<ChunkedBatchOwlClaimResult> {
  const batchSize = getClaimAllBatchSize()
  const split = splitClaimAllPlansIntoPayableBatches(params.plans, batchSize)
  const chunks = split.payableChunks
  const skippedBelowMinimum: ClaimAllSkippedBelowMinimum[] = split.skippedBelowMinimum.map((p) => ({
    position_id: p.positionId,
    pending_owl: p.payoutAmount,
  }))

  if (skippedBelowMinimum.length > 0 && params.onSkippedBelowMinimum) {
    await params.onSkippedBelowMinimum(split.skippedBelowMinimum.map((p) => p.positionId))
  }

  if (chunks.length === 0) {
    return {
      total_claimed: 0,
      claims: [],
      transaction_signature: null,
      execution_path: 'database_only',
      batch_count: 0,
      transaction_signatures: [],
      skipped_below_minimum: skippedBelowMinimum,
    }
  }

  if (chunks.length === 1) {
    if (params.onBeforeBatch) {
      await params.onBeforeBatch()
    }
    let singlePlans = chunks[0]!
    if (params.refreshBatchPlans) {
      singlePlans = await params.refreshBatchPlans(singlePlans)
    }
    if (singlePlans.length === 0 || !meetsMinOwlClaimThreshold(sumPayout(singlePlans))) {
      return {
        total_claimed: 0,
        claims: [],
        transaction_signature: null,
        execution_path: 'database_only',
        batch_count: 0,
        transaction_signatures: [],
        skipped_below_minimum: skippedBelowMinimum,
      }
    }
    const single = await executeBatchOwlClaims({
      wallet: params.wallet,
      pool: params.pool,
      plans: singlePlans,
    })
    const sig = single.transaction_signature?.trim() || null
    return {
      ...single,
      batch_count: 1,
      transaction_signatures: sig ? [sig] : [],
      skipped_below_minimum: skippedBelowMinimum,
    }
  }

  const claims: BatchOwlClaimResult['claims'] = []
  const transactionSignatures: string[] = []
  let totalClaimed = 0
  let executionPath: BatchOwlClaimResult['execution_path'] = 'database_only'

  for (let i = 0; i < chunks.length; i++) {
    if (shouldStopClaimAllBatchesForDeadline(params.deadlineMs)) {
      if (totalClaimed > 0) {
        throwClaimAllPartialBatch({
          batchesCompleted: i,
          batchCount: chunks.length,
          totalClaimed,
          transactionSignatures,
          claims,
        })
      }
      throw new StakingUserError(
        'Claim all ran out of time before sending OWL. Wait a moment and tap Claim all again — your platform fee can be reused.',
        503,
        { code: 'claim_all_deadline_exhausted' }
      )
    }

    if (params.onBeforeBatch) {
      await params.onBeforeBatch()
    }

    let chunk = chunks[i]!
    if (params.refreshBatchPlans) {
      const refreshed = await params.refreshBatchPlans(chunk)
      if (refreshed.length === 0) {
        continue
      }
      chunk = refreshed
    }

    if (!meetsMinOwlClaimThreshold(sumPayout(chunk))) {
      skippedBelowMinimum.push(
        ...chunk.map((p) => ({ position_id: p.positionId, pending_owl: p.payoutAmount }))
      )
      if (params.onSkippedBelowMinimum) {
        await params.onSkippedBelowMinimum(chunk.map((p) => p.positionId))
      }
      continue
    }

    let result: BatchOwlClaimResult | null = null
    let lastError: unknown
    // One retry per batch absorbs transient RPC / blockhash failures without stranding remaining nests.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await executeBatchOwlClaims({
          wallet: params.wallet,
          pool: params.pool,
          plans: chunk,
        })
        lastError = undefined
        break
      } catch (e) {
        lastError = e
        if (attempt === 0 && shouldRetryFailedClaimBatch(e)) {
          await new Promise((r) => setTimeout(r, 400))
          continue
        }
        break
      }
    }
    if (!result) {
      if (totalClaimed > 0) {
        throwClaimAllPartialBatch({
          batchesCompleted: i,
          batchCount: chunks.length,
          totalClaimed,
          transactionSignatures,
          claims,
        })
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Claim batch failed'))
    }
    totalClaimed += result.total_claimed
    claims.push(...result.claims)
    if (result.execution_path === 'onchain_transfer') {
      executionPath = 'onchain_transfer'
    }
    const sig = result.transaction_signature?.trim()
    if (sig) transactionSignatures.push(sig)
    if (params.onBatchCompleted) {
      await params.onBatchCompleted(chunk.map((p) => p.positionId))
    }
  }

  return {
    total_claimed: totalClaimed,
    claims,
    transaction_signature: transactionSignatures[transactionSignatures.length - 1] ?? null,
    execution_path: executionPath,
    batch_count: chunks.length,
    transaction_signatures: transactionSignatures,
    skipped_below_minimum: skippedBelowMinimum,
  }
}
