import type { PositionClaimPlan } from '@/lib/nesting/claim-plan'
import { meetsMinOwlClaimThreshold } from '@/lib/staking/rewards'
import { getClaimAllBatchSize } from '@/lib/nesting/policy'

export type ClaimAllBatchSplit = {
  payableChunks: PositionClaimPlan[][]
  skippedBelowMinimum: PositionClaimPlan[]
}

function chunkPlans(plans: PositionClaimPlan[], size: number): PositionClaimPlan[][] {
  if (size <= 0 || plans.length <= size) return [plans]
  const chunks: PositionClaimPlan[][] = []
  for (let i = 0; i < plans.length; i += size) {
    chunks.push(plans.slice(i, i + size))
  }
  return chunks
}

function sumPayout(plans: PositionClaimPlan[]): number {
  return plans.reduce((sum, p) => sum + p.payoutAmount, 0)
}

/**
 * Claim-all batches must each transfer ≥1 OWL. Largest-first ordering leaves a dust tail;
 * merge into the previous batch when it fits, otherwise skip those nests (still accruing).
 */
export function splitClaimAllPlansIntoPayableBatches(
  plans: PositionClaimPlan[],
  batchSize: number = getClaimAllBatchSize()
): ClaimAllBatchSplit {
  if (plans.length === 0) {
    return { payableChunks: [], skippedBelowMinimum: [] }
  }

  const skippedBelowMinimum: PositionClaimPlan[] = []
  let chunks = chunkPlans(plans, batchSize)

  while (chunks.length > 1) {
    const last = chunks[chunks.length - 1]!
    if (meetsMinOwlClaimThreshold(sumPayout(last))) break

    const prev = chunks[chunks.length - 2]!
    if (prev.length + last.length <= batchSize) {
      chunks[chunks.length - 2] = [...prev, ...last]
      chunks.pop()
      if (meetsMinOwlClaimThreshold(sumPayout(chunks[chunks.length - 1]!))) break
      continue
    }

    skippedBelowMinimum.push(...last)
    chunks.pop()
  }

  if (chunks.length === 1) {
    const only = chunks[0]!
    if (!meetsMinOwlClaimThreshold(sumPayout(only))) {
      skippedBelowMinimum.push(...only)
      chunks = []
    }
  }

  const payableChunks = chunks.filter((chunk) => chunk.length > 0 && meetsMinOwlClaimThreshold(sumPayout(chunk)))
  return { payableChunks, skippedBelowMinimum }
}
