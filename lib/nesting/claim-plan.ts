import type { StakingPositionRow } from '@/lib/db/staking-positions'
import type { RewardRateUnit } from '@/lib/db/staking-pools'
import {
  estimateAccruedRewards,
  estimateClaimableRewards,
  meetsMinOwlClaimThreshold,
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

/** Active OWL nests with a claimable balance at `asOfMs` (same rules as Claim all). */
export function buildOwlClaimPlansForPositions(
  rows: StakingPositionRow[],
  asOfMs = Date.now()
): PositionClaimPlan[] {
  const plans: PositionClaimPlan[] = []
  for (const row of rows) {
    if (row.status !== 'active' || !isOwlRewardPosition(row)) continue
    const plan = buildFullPositionClaimPlan(row, asOfMs)
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

/** Sum of pending OWL on all active nests (no 1 OWL per-nest floor — for live “accruing” display). */
export function sumOwlPendingAccrualForPositions(
  rows: StakingPositionRow[],
  asOfMs = Date.now()
): number {
  let total = 0
  for (const row of rows) {
    if (row.status !== 'active' || !isOwlRewardPosition(row)) continue
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
  asOfMs = Date.now()
): PositionClaimPlan | null {
  if (row.status !== 'active') return null

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
  if (paysOwlRewards && !meetsMinOwlClaimThreshold(claimableNow)) return null
  if (!paysOwlRewards && claimableNow <= 1e-12) return null

  return {
    positionId: row.id,
    payoutAmount: claimableNow,
    newClaimedTotal: accruedNow,
    claimableNow,
  }
}

export function noClaimableRewardsMessage(): string {
  return `No nests have claimable OWL right now. ${minOwlClaimThresholdMessage()}`
}

export function minOwlClaimThresholdMessage(): string {
  return 'Claim unlocks once at least 1 OWL has accrued for a nest.'
}
