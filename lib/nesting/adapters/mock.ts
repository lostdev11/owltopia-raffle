/**
 * Database-backed staking adapter — preserves pre–Phase 2 Owl Nesting behavior.
 */

import type { StakingMutationAdapter } from '@/lib/nesting/adapters/types'
import {
  insertStakingPosition,
  markPositionUnstaked,
  recordRewardClaim,
  getStakingPositionForWallet,
} from '@/lib/db/staking-positions'
export const mockStakingAdapter: StakingMutationAdapter = {
  async stakeIntoPool(input) {
    const { wallet, pool, amount, asset_identifier } = input
    const stakedAt = new Date()
    const unlockAt =
      pool.lock_period_days <= 0
        ? null
        : new Date(stakedAt.getTime() + pool.lock_period_days * 24 * 60 * 60 * 1000)

    const position = await insertStakingPosition({
      wallet_address: wallet,
      pool_id: pool.id,
      asset_identifier,
      amount,
      reward_rate_snapshot: Number(pool.reward_rate),
      reward_rate_unit_snapshot: pool.reward_rate_unit,
      reward_token_snapshot: pool.reward_token,
      staked_at: stakedAt.toISOString(),
      unlock_at: unlockAt?.toISOString() ?? null,
      status: 'active',
    })

    return { position }
  },

  async unstakePosition(input) {
    const position = await markPositionUnstaked(input.positionId, input.wallet)
    return { position }
  },

  async claimPositionRewards(input) {
    const row = await getStakingPositionForWallet(input.positionId, input.wallet)
    if (!row) {
      throw new Error('Position not found')
    }

    const newTotal = Number(row.claimed_rewards) + input.amount

    await recordRewardClaim({
      positionId: input.positionId,
      wallet: input.wallet,
      amount: input.amount,
      newClaimedTotal: newTotal,
      note: 'mvp_db_claim',
    })

    return {
      claimed: input.amount,
      claimed_rewards_total: newTotal,
    }
  },
}
