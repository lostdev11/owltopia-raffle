import type { StakingMutationAdapter } from '@/lib/nesting/adapters/types'
import { StakingUserError } from '@/lib/nesting/errors'
import { insertStakingPosition, markPositionUnstaked, recordRewardClaim, getStakingPositionForWallet } from '@/lib/db/staking-positions'
import { assertMetaplexCoreAssetInEscrow } from '@/lib/nesting/metaplex-core'

async function stakeOnChain(input: Parameters<StakingMutationAdapter['stakeIntoPool']>[0]) {
  if (input.pool.asset_type !== 'nft') {
    throw new StakingUserError(
      'On-chain nesting currently supports NFT custody pools only.',
      501
    )
  }
  if (!input.asset_identifier) {
    throw new StakingUserError('asset_identifier is required for on-chain NFT staking.', 400)
  }

  await assertMetaplexCoreAssetInEscrow({
    assetId: input.asset_identifier,
    collectionMint: input.pool.collection_key,
  })

  const stakedAt = new Date()
  const unlockAt =
    input.pool.lock_period_days <= 0
      ? null
      : new Date(stakedAt.getTime() + input.pool.lock_period_days * 24 * 60 * 60 * 1000)

  const position = await insertStakingPosition({
    wallet_address: input.wallet,
    pool_id: input.pool.id,
    asset_identifier: input.asset_identifier,
    amount: input.amount,
    reward_rate_snapshot: Number(input.pool.reward_rate),
    reward_rate_unit_snapshot: input.pool.reward_rate_unit,
    reward_token_snapshot: input.pool.reward_token,
    staked_at: stakedAt.toISOString(),
    unlock_at: unlockAt?.toISOString() ?? null,
    status: 'active',
  })

  return { position }
}

export const solanaStakingAdapterStub: StakingMutationAdapter = {
  async stakeIntoPool(input) {
    return stakeOnChain(input)
  },
  async unstakePosition(input) {
    // Unstake remains read-model only for now; custody release tx is handled by escrow ops flow.
    const position = await markPositionUnstaked(input.positionId, input.wallet)
    return { position }
  },
  async claimPositionRewards(input) {
    const row = await getStakingPositionForWallet(input.positionId, input.wallet)
    if (!row) throw new StakingUserError('Position not found', 404)
    const newTotal = Number(row.claimed_rewards) + input.amount
    await recordRewardClaim({
      positionId: input.positionId,
      wallet: input.wallet,
      amount: input.amount,
      newClaimedTotal: newTotal,
      note: 'onchain_reward_distribution_policy',
    })
    return { claimed: input.amount, claimed_rewards_total: newTotal }
  },
}
