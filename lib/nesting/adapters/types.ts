import type { StakingPoolRow } from '@/lib/db/staking-pools'
import type { StakingPositionRow } from '@/lib/db/staking-positions'

/** Mutations executed after validation in `lib/nesting/service.ts`. */
export interface StakingMutationAdapter {
  stakeIntoPool(input: StakeIntoPoolInput): Promise<{ position: StakingPositionRow }>
  unstakePosition(input: UnstakePositionInput): Promise<{ position: StakingPositionRow }>
  claimPositionRewards(input: ClaimPositionInput): Promise<{
    claimed: number
    claimed_rewards_total: number
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
}

export type ClaimPositionInput = {
  wallet: string
  positionId: string
  amount: number
}
