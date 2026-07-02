import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { executeBatchOwlClaims, type BatchOwlClaimResult } from '@/lib/nesting/batch-claim'
import type { PositionClaimPlan } from '@/lib/nesting/claim-plan'
import { getClaimAllBatchSize } from '@/lib/nesting/policy'
import { StakingUserError } from '@/lib/nesting/errors'

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

/**
 * Runs Claim all in server-side batches so large wallets stay within RPC/time limits.
 * Platform fee should be validated before and committed only after every batch succeeds.
 */
export async function executeChunkedBatchOwlClaims(params: {
  wallet: string
  pool: StakingPoolRow
  plans: PositionClaimPlan[]
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
    const chunk = chunks[i]!
    try {
      const result = await executeBatchOwlClaims({
        wallet: params.wallet,
        pool: params.pool,
        plans: chunk,
      })
      totalClaimed += result.total_claimed
      claims.push(...result.claims)
      if (result.execution_path === 'onchain_transfer') {
        executionPath = 'onchain_transfer'
      }
      const sig = result.transaction_signature?.trim()
      if (sig) transactionSignatures.push(sig)
    } catch (e) {
      if (totalClaimed > 0) {
        throw new StakingUserError(
          `OWL was sent for ${i} of ${chunks.length} batches (${totalClaimed.toLocaleString(undefined, { maximumFractionDigits: 6 })} OWL total). Refresh your wallet and dashboard — do not Claim all again until balances update. Contact support if any nests still show claimable OWL.`,
          503,
          {
            code: 'claim_all_partial_batch',
            batches_completed: i,
            batch_count: chunks.length,
            total_claimed: totalClaimed,
            transaction_signatures: transactionSignatures,
          }
        )
      }
      throw e
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
