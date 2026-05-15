import type { StakingMutationAdapter } from '@/lib/nesting/adapters/types'
import { StakingUserError } from '@/lib/nesting/errors'
import {
  insertStakingPosition,
  markPositionUnstaked,
  recordRewardClaim,
  getStakingPositionForWallet,
} from '@/lib/db/staking-positions'
import { getStakingPoolById } from '@/lib/db/staking-pools'
import { getTokenInfo } from '@/lib/tokens'
import { decimalToRawBigint } from '@/lib/nesting/token-amount'
import {
  getOwlStakeMintForPool,
  getVaultOwnerForPool,
  transferNestingTokenFromVaultToWallet,
} from '@/lib/nesting/token-stake-transfer'
import { tryTransferOwlRewardClaim } from '@/lib/nesting/owl-reward-claim-transfer'
import { resolveRewardClaimRecording } from '@/lib/nesting/reward-claim-record'
import { thawWalletNftForNesting } from '@/lib/nesting/nft-freeze'

async function stakeOnChain(input: Parameters<StakingMutationAdapter['stakeIntoPool']>[0]) {
  if (input.pool.asset_type === 'token') {
    if (!getOwlStakeMintForPool(input.pool)) {
      throw new StakingUserError('On-chain token staking currently requires the configured OWL mint.', 400)
    }
    if (!getVaultOwnerForPool(input.pool)) {
      throw new StakingUserError('Pool vault address is required before on-chain staking can be enabled.', 400)
    }

    const stakedAt = new Date()
    const unlockAt =
      input.pool.lock_period_days <= 0
        ? null
        : new Date(stakedAt.getTime() + input.pool.lock_period_days * 24 * 60 * 60 * 1000)

    const position = await insertStakingPosition({
      wallet_address: input.wallet,
      pool_id: input.pool.id,
      asset_identifier: null,
      amount: input.amount,
      reward_rate_snapshot: Number(input.pool.reward_rate),
      reward_rate_unit_snapshot: input.pool.reward_rate_unit,
      reward_token_snapshot: input.pool.reward_token,
      staked_at: stakedAt.toISOString(),
      unlock_at: unlockAt?.toISOString() ?? null,
      status: 'pending',
      sync_status: 'pending',
      external_reference: 'awaiting_token_stake_transfer',
    })

    return { position }
  }

  if (!input.asset_identifier) {
    throw new StakingUserError('asset_identifier is required for on-chain NFT staking.', 400)
  }

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
    status: 'pending',
    sync_status: 'pending',
    external_reference: 'awaiting_nft_freeze',
  })

  return { position }
}

export const solanaStakingAdapterStub: StakingMutationAdapter = {
  async stakeIntoPool(input) {
    return stakeOnChain(input)
  },
  async unstakePosition(input) {
    const row = await getStakingPositionForWallet(input.positionId, input.wallet)
    if (!row) throw new StakingUserError('Position not found', 404)
    const pool = await getStakingPoolById(row.pool_id)
    if (!pool) throw new StakingUserError('Pool not found', 400)

    if (pool.asset_type === 'token') {
      const owl = getTokenInfo('OWL')
      if (!owl.mintAddress) throw new StakingUserError('OWL is not configured.', 503)
      const amountRaw = decimalToRawBigint(row.amount, owl.decimals)
      const transfer = await transferNestingTokenFromVaultToWallet({
        pool,
        recipientWallet: input.wallet,
        amountRaw,
      })
      if (!transfer.ok) throw new StakingUserError(transfer.error, 503)
      const position = await markPositionUnstaked(input.positionId, input.wallet, {
        unstake_signature: transfer.signature,
        sync_status: 'confirmed',
        last_synced_at: new Date().toISOString(),
        last_transaction_error: null,
      })
      return { position }
    }

    if (!row.asset_identifier?.trim()) {
      throw new StakingUserError('NFT asset id is missing for this nest.', 400)
    }
    const thawed = await thawWalletNftForNesting({
      assetId: row.asset_identifier,
      ownerWallet: input.wallet,
      /** Wrong pool.collection_key breaks Helius grouping + thaw; recovery uses on-chain asset authority. */
      collectionMint: input.adminRecoveryUnstake === true ? null : pool.collection_key,
      adminRecoveryUnstake: input.adminRecoveryUnstake === true,
    })
    const position = await markPositionUnstaked(input.positionId, input.wallet, {
      unstake_signature: thawed.signature,
      sync_status: 'confirmed',
      last_synced_at: new Date().toISOString(),
      last_transaction_error: null,
      external_reference: `nft_thaw_confirmed:${thawed.tokenAccount}`,
    })
    return { position }
  },
  async claimPositionRewards(input) {
    const row = await getStakingPositionForWallet(input.positionId, input.wallet)
    if (!row) throw new StakingUserError('Position not found', 404)
    const pool = await getStakingPoolById(row.pool_id)
    if (!pool) throw new StakingUserError('Pool not found', 400)

    const transfer = await tryTransferOwlRewardClaim({
      pool,
      recipientWallet: input.wallet,
      claimAmountUi: input.amount,
    })
    const { txSig, note } = resolveRewardClaimRecording({
      poolRewardToken: pool.reward_token,
      transfer,
      claimAmountUi: input.amount,
    })

    await recordRewardClaim({
      positionId: input.positionId,
      wallet: input.wallet,
      amount: input.amount,
      newClaimedTotal: input.newClaimedTotal,
      note,
      transaction_signature: txSig,
      last_claim_signature: txSig,
    })
    return {
      claimed: input.amount,
      claimed_rewards_total: input.newClaimedTotal,
      transaction_signature: txSig,
    }
  },
}
