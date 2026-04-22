/**
 * Pure DB/API reward estimation for Owl Nesting MVP (no RPC).
 * Replace with adapter + on-chain rules when Solana staking is wired in.
 */

import type { RewardRateUnit } from '@/lib/db/staking-pools'

export type { RewardRateUnit }

/** Total accrued rewards from stake time to `asOf` using snapshot rate × amount × elapsed periods. */
export function estimateAccruedRewards(params: {
  amount: number
  rewardRateSnapshot: number
  rewardRateUnitSnapshot: RewardRateUnit
  stakedAtMs: number
  asOfMs: number
}): number {
  const { amount, rewardRateSnapshot, rewardRateUnitSnapshot, stakedAtMs, asOfMs } = params
  if (amount <= 0 || rewardRateSnapshot <= 0 || asOfMs <= stakedAtMs) return 0

  const elapsedMs = asOfMs - stakedAtMs

  switch (rewardRateUnitSnapshot) {
    case 'hourly': {
      const hours = elapsedMs / (60 * 60 * 1000)
      return amount * rewardRateSnapshot * hours
    }
    case 'weekly': {
      const weeks = elapsedMs / (7 * 24 * 60 * 60 * 1000)
      return amount * rewardRateSnapshot * weeks
    }
    case 'daily':
    default: {
      const days = elapsedMs / (24 * 60 * 60 * 1000)
      return amount * rewardRateSnapshot * days
    }
  }
}

/** Rewards not yet claimed (approximation from snapshots). */
export function estimateClaimableRewards(params: {
  amount: number
  rewardRateSnapshot: number
  rewardRateUnitSnapshot: RewardRateUnit
  claimedRewards: number
  stakedAtMs: number
  asOfMs: number
}): number {
  const accrued = estimateAccruedRewards(params)
  const pending = accrued - params.claimedRewards
  return pending > 0 ? pending : 0
}
