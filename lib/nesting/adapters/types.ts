import type { StakingPoolRow } from '@/lib/db/staking-pools'
import type { StakingPositionRow } from '@/lib/db/staking-positions'

/** Mutations executed after validation in `lib/nesting/service.ts`. */
export interface StakingMutationAdapter {
  stakeIntoPool(input: StakeIntoPoolInput): Promise<{ position: StakingPositionRow }>
  unstakePosition(input: UnstakePositionInput): Promise<{ position: StakingPositionRow }>
  claimPositionRewards(input: ClaimPositionInput): Promise<{
    claimed: number
    claimed_rewards_total: number
    /** Set when OWL was sent on-chain from the reward treasury. */
    transaction_signature?: string | null
  }>
}

export type StakeIntoPoolInput = {
  wallet: string
  pool: StakingPoolRow
  amount: number
  asset_identifier: string | null
}

export type UnstakePositionInput = {
  wallet: string
  positionId: string
  /**
   * When true (admin override only), thaw skips Helius `getAsset` collection grouping checks
   * and only verifies MPL Core on-chain ownership — for recovery when `collection_key` / DAS mismatch.
   */
  adminRecoveryUnstake?: boolean
}

export type ClaimPositionInput = {
  wallet: string
  positionId: string
  /** OWL (or pool reward unit) actually delivered for this claim. */
  amount: number
  /**
   * `staking_positions.claimed_rewards` after this claim. The service sets this with a
   * full-claim snap to current accrued so the UI can read “0” until more rewards accrue.
   */
  newClaimedTotal: number
}
