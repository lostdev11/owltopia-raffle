import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { executeBatchOwlClaims, type BatchOwlClaimResult } from '@/lib/nesting/batch-claim'
import { isBatchClaimLedgerSyncError } from '@/lib/nesting/batch-claim-errors'
import type { PositionClaimPlan } from '@/lib/nesting/claim-plan'
import { shouldStopClaimAllBatchesForDeadline } from '@/lib/nesting/claim-all-deadline'
import { getClaimAllBatchSize } from '@/lib/nesting/policy'
import { isStakingUserError, StakingUserError } from '@/lib/nesting/errors'

export type ChunkedBatchOwlClaimResult = BatchOwlClaimResult & {
  batch_count: number
  transaction_signatures: string[]
}

function chunkPlans(plans: PositionClaimPlan[], size: number): PositionClaimPlan[][] {
  if (size <= 0 || plans.length <= size) return [plans]
  const chunks: PositionClaimPlan[][] = []
  for (let i = 0; i < plans.length; i += size) {
    chunks.push(plans.slice(i, i + size))
  }
  return chunks
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
  /** Called after each successful batch with that batch's nest ids (fee linking). */
  onBatchCompleted?: (positionIds: string[]) => Promise<void>
}): Promise<ChunkedBatchOwlClaimResult> {
  const batchSize = getClaimAllBatchSize()
  const chunks = chunkPlans(params.plans, batchSize)

  if (chunks.length === 1) {
    const single = await executeBatchOwlClaims({
      wallet: params.wallet,
      pool: params.pool,
      plans: chunks[0]!,
    })
    const sig = single.transaction_signature?.trim() || null
    return {
      ...single,
      batch_count: 1,
      transaction_signatures: sig ? [sig] : [],
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

    const chunk = chunks[i]!
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
  }
}
