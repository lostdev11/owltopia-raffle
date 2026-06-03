import type { StakingPositionRow } from '@/lib/db/staking-positions'
import type { RewardRateUnit } from '@/lib/db/staking-pools'
import {
  estimateAccruedRewards,
  estimateClaimableRewards,
  meetsMinOwlClaimThreshold,
  MIN_OWL_CLAIMABLE_TO_CLAIM,
} from '@/lib/staking/rewards'

export type PositionClaimPlan = {
  positionId: string
  payoutAmount: number
  newClaimedTotal: number
  claimableNow: number
}

export function isOwlRewardPosition(
  row: Pick<StakingPositionRow, 'reward_token_snapshot'>
): boolean {
  return (row.reward_token_snapshot ?? '').trim().toUpperCase() === 'OWL'
}

/** Active OWL nest rows must reference an on-chain mint to claim or verify locks. */
export function activeOwlNestHasMint(
  row: Pick<StakingPositionRow, 'status' | 'reward_token_snapshot' | 'asset_identifier'>
): boolean {
  if (row.status !== 'active' || !isOwlRewardPosition(row)) return true
  return Boolean(row.asset_identifier?.trim())
}

export type BuildOwlClaimPlansOptions = {
  /**
   * Claim all: include every nest with pending OWL when the combined total meets the 1 OWL minimum.
   * Per-nest claims still require ≥1 OWL on that nest.
   */
  forClaimAll?: boolean
}

/** Active OWL nests with a claimable balance at `asOfMs`. */
export function buildOwlClaimPlansForPositions(
  rows: StakingPositionRow[],
  asOfMs = Date.now(),
  options?: BuildOwlClaimPlansOptions
): PositionClaimPlan[] {
  const plans: PositionClaimPlan[] = []
  for (const row of rows) {
    if (row.status !== 'active' || !isOwlRewardPosition(row)) continue
    if (!activeOwlNestHasMint(row)) continue
    const plan = buildFullPositionClaimPlan(row, asOfMs, options)
    if (plan) plans.push(plan)
  }
  return plans
}

export function sumOwlClaimPlans(plans: PositionClaimPlan[]): { count: number; totalOwl: number } {
  let totalOwl = 0
  for (const plan of plans) {
    totalOwl += plan.payoutAmount
  }
  return { count: plans.length, totalOwl }
}

/** Claim-all eligibility for any wallet’s active OWL nests (combined ≥1 OWL minimum). */
export function buildOwlClaimAllPreview(
  rows: StakingPositionRow[],
  asOfMs = Date.now()
): { plans: PositionClaimPlan[]; count: number; totalOwl: number; ready: boolean } {
  const plans = buildOwlClaimPlansForPositions(rows, asOfMs, { forClaimAll: true })
  const { count, totalOwl } = sumOwlClaimPlans(plans)
  return { plans, count, totalOwl, ready: meetsMinOwlClaimThreshold(totalOwl) }
}

/** Sum of pending OWL on all active nests (no 1 OWL per-nest floor — for live “accruing” display). */
export function sumOwlPendingAccrualForPositions(
  rows: StakingPositionRow[],
  asOfMs = Date.now()
): number {
  let total = 0
  for (const row of rows) {
    if (row.status !== 'active' || !isOwlRewardPosition(row)) continue
    if (!activeOwlNestHasMint(row)) continue
    total += estimateClaimableRewards({
      amount: Number(row.amount),
      rewardRateSnapshot: Number(row.reward_rate_snapshot),
      rewardRateUnitSnapshot: row.reward_rate_unit_snapshot as RewardRateUnit,
      claimedRewards: Number(row.claimed_rewards),
      stakedAtMs: new Date(row.staked_at).getTime(),
      asOfMs,
    })
  }
  return total
}

/** Max-claim plan for an active nest (full pending balance). Returns null if nothing claimable. */
export function buildFullPositionClaimPlan(
  row: StakingPositionRow,
  asOfMs = Date.now(),
  options?: BuildOwlClaimPlansOptions
): PositionClaimPlan | null {
  if (row.status !== 'active') return null
  if (!activeOwlNestHasMint(row)) return null

  const stakedAtMs = new Date(row.staked_at).getTime()
  const stakeAmount = Number(row.amount)
  const rewardRateSnapshot = Number(row.reward_rate_snapshot)
  const rewardRateUnitSnapshot = row.reward_rate_unit_snapshot as RewardRateUnit
  const oldClaimed = Number(row.claimed_rewards)

  const accruedNow = estimateAccruedRewards({
    amount: stakeAmount,
    rewardRateSnapshot,
    rewardRateUnitSnapshot,
    stakedAtMs,
    asOfMs,
  })
  const claimableNow = Math.max(0, accruedNow - oldClaimed)
  const paysOwlRewards = (row.reward_token_snapshot ?? '').trim().toUpperCase() === 'OWL'
  if (paysOwlRewards) {
    if (options?.forClaimAll) {
      if (claimableNow <= 1e-12) return null
    } else if (!meetsMinOwlClaimThreshold(claimableNow)) {
      return null
    }
  } else if (claimableNow <= 1e-12) {
    return null
  }

  return {
    positionId: row.id,
    payoutAmount: claimableNow,
    newClaimedTotal: accruedNow,
    claimableNow,
  }
}

export function noClaimableRewardsMessage(): string {
  return `No claimable OWL right now. ${minOwlClaimAllThresholdMessage()}`
}

export function minOwlClaimThresholdMessage(): string {
  return 'Per-nest claim unlocks once at least 1 OWL has accrued on that nest.'
}

export function minOwlClaimAllThresholdMessage(): string {
  return 'Claim all unlocks when your active nests total at least 1 OWL combined (each nest can be below 1 OWL).'
}

export function minOwlClaimPayoutRejectedMessage(payoutAmount: number): string {
  return `Each OWL claim must be at least ${MIN_OWL_CLAIMABLE_TO_CLAIM}. You tried ${payoutAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} OWL.`
}
