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

/** Minimum claimable OWL (UI units) before the claim action is allowed (per nest position). */
export const MIN_OWL_CLAIMABLE_TO_CLAIM = 1

export function meetsMinOwlClaimThreshold(claimableUi: number): boolean {
  if (!Number.isFinite(claimableUi)) return false
  return claimableUi >= MIN_OWL_CLAIMABLE_TO_CLAIM - 1e-9
}

/** OWL nesting: same as {@link meetsMinOwlClaimThreshold}. */
export function hasClaimableRewardBalance(claimableUi: number): boolean {
  return meetsMinOwlClaimThreshold(claimableUi)
}

/** True when an OWL payout amount is allowed (minimum 1 OWL; no upper cap beyond pending balance). */
export function isValidOwlClaimPayoutAmount(payoutUi: number): boolean {
  return meetsMinOwlClaimThreshold(payoutUi)
}

/** Non-zero pending slice included in a combined Claim all batch (per-nest amount may be below 1 OWL). */
export function isPositiveOwlClaimSlice(payoutUi: number): boolean {
  return Number.isFinite(payoutUi) && payoutUi > 1e-12
}

/** User-facing rules for OWL claim minimum and that larger amounts are supported. */
export function owlClaimAmountRulesMessage(): string {
  return `Each claim must be at least ${MIN_OWL_CLAIMABLE_TO_CLAIM} OWL. You can claim any amount from ${MIN_OWL_CLAIMABLE_TO_CLAIM} OWL up to your full pending balance on that nest.`
}
