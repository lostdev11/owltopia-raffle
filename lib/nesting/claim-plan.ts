import type { StakingPositionRow } from '@/lib/db/staking-positions'
import type { RewardRateUnit } from '@/lib/db/staking-pools'
import { estimateAccruedRewards, hasClaimableRewardBalance } from '@/lib/staking/rewards'

export type PositionClaimPlan = {
  positionId: string
  payoutAmount: number
  newClaimedTotal: number
  claimableNow: number
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
  if (!hasClaimableRewardBalance(claimableNow)) return null

  return {
    positionId: row.id,
    payoutAmount: claimableNow,
    newClaimedTotal: accruedNow,
    claimableNow,
  }
}

export function noClaimableRewardsMessage(): string {
  return 'No OWL rewards are ready to claim on your nests yet — keep nesting and check back.'
}
