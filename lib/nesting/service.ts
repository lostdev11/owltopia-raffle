/**
 * Owl Nesting application layer — validates inputs then delegates to a staking adapter.
 */

import { getStakingPoolById } from '@/lib/db/staking-pools'
import type { RewardRateUnit } from '@/lib/db/staking-pools'
import { getStakingPositionForWallet } from '@/lib/db/staking-positions'
import { estimateClaimableRewards } from '@/lib/staking/rewards'
import { StakingUserError } from '@/lib/nesting/errors'
import { resolveMutationAdapter } from '@/lib/nesting/resolve-adapter'
import { STAKING_UUID_RE } from '@/lib/nesting/validation'

export async function executeStake(params: {
  wallet: string
  pool_id: string
  rawAmount: unknown
  rawAssetIdentifier: unknown
}) {
  const pool_id = params.pool_id.trim()
  if (!STAKING_UUID_RE.test(pool_id)) {
    throw new StakingUserError('Invalid pool_id', 400)
  }

  const pool = await getStakingPoolById(pool_id)
  if (!pool || !pool.is_active) {
    throw new StakingUserError('Pool not found or inactive', 400)
  }

  let amount =
    params.rawAmount !== undefined && params.rawAmount !== null ? Number(params.rawAmount) : NaN
  if (pool.asset_type === 'nft') {
    if (Number.isNaN(amount) || amount <= 0) amount = 1
  } else {
    if (Number.isNaN(amount) || amount <= 0) {
      throw new StakingUserError('amount must be a positive number', 400)
    }
  }

  const asset_identifier =
    typeof params.rawAssetIdentifier === 'string' && params.rawAssetIdentifier.trim()
      ? params.rawAssetIdentifier.trim()
      : null

  if (pool.minimum_stake != null && amount < Number(pool.minimum_stake)) {
    throw new StakingUserError(`amount below minimum_stake (${pool.minimum_stake})`, 400)
  }
  if (pool.maximum_stake != null && amount > Number(pool.maximum_stake)) {
    throw new StakingUserError(`amount above maximum_stake (${pool.maximum_stake})`, 400)
  }

  const adapter = resolveMutationAdapter(pool)
  return adapter.stakeIntoPool({
    wallet: params.wallet,
    pool,
    amount,
    asset_identifier,
  })
}

export async function executeUnstake(params: { wallet: string; position_id: string }) {
  const position_id = params.position_id.trim()
  if (!STAKING_UUID_RE.test(position_id)) {
    throw new StakingUserError('Invalid position_id', 400)
  }

  const existing = await getStakingPositionForWallet(position_id, params.wallet)
  if (!existing) {
    throw new StakingUserError('Position not found', 404)
  }
  if (existing.status !== 'active') {
    throw new StakingUserError('Position is not active', 400)
  }

  if (existing.unlock_at) {
    const unlockMs = new Date(existing.unlock_at).getTime()
    if (!Number.isNaN(unlockMs) && Date.now() < unlockMs) {
      throw new StakingUserError('Lock period not ended', 400, {
        unlock_at: existing.unlock_at,
      })
    }
  }

  const pool = await getStakingPoolById(existing.pool_id)
  if (!pool) {
    throw new StakingUserError('Pool not found', 400)
  }

  const adapter = resolveMutationAdapter(pool)
  return adapter.unstakePosition({
    wallet: params.wallet,
    positionId: position_id,
  })
}

export async function executeClaim(params: {
  wallet: string
  position_id: string
  rawAmount: unknown
}) {
  const position_id = params.position_id.trim()
  if (!STAKING_UUID_RE.test(position_id)) {
    throw new StakingUserError('Invalid position_id', 400)
  }

  const amount = Number(params.rawAmount)
  if (Number.isNaN(amount) || amount <= 0) {
    throw new StakingUserError('amount must be a positive number', 400)
  }

  const row = await getStakingPositionForWallet(position_id, params.wallet)
  if (!row) {
    throw new StakingUserError('Position not found', 404)
  }
  if (row.status !== 'active') {
    throw new StakingUserError('Position is not active', 400)
  }

  const claimable = estimateClaimableRewards({
    amount: Number(row.amount),
    rewardRateSnapshot: Number(row.reward_rate_snapshot),
    rewardRateUnitSnapshot: row.reward_rate_unit_snapshot as RewardRateUnit,
    claimedRewards: Number(row.claimed_rewards),
    stakedAtMs: new Date(row.staked_at).getTime(),
    asOfMs: Date.now(),
  })

  if (amount > claimable + 1e-9) {
    throw new StakingUserError('amount exceeds claimable rewards', 400, { claimable })
  }

  const pool = await getStakingPoolById(row.pool_id)
  if (!pool) {
    throw new StakingUserError('Pool not found', 400)
  }

  const adapter = resolveMutationAdapter(pool)
  return adapter.claimPositionRewards({
    wallet: params.wallet,
    positionId: position_id,
    amount,
  })
}
