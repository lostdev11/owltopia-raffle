/**
 * Owl Nesting application layer — validates inputs then delegates to a staking adapter.
 */

import { getStakingPoolById } from '@/lib/db/staking-pools'
import type { RewardRateUnit } from '@/lib/db/staking-pools'
import { getActivePositionByAssetIdentifier, getStakingPositionForWallet } from '@/lib/db/staking-positions'
import { estimateAccruedRewards, meetsMinOwlClaimThreshold, MIN_OWL_CLAIMABLE_TO_CLAIM } from '@/lib/staking/rewards'
import { StakingUserError } from '@/lib/nesting/errors'
import { resolveMutationAdapter } from '@/lib/nesting/resolve-adapter'
import { STAKING_UUID_RE } from '@/lib/nesting/validation'
import {
  assertNestingSelloutReached,
  assertRewardTreasuryConfigured,
  isNestingDbOnlyOwlClaimsAllowed,
  validatePoolAgainstNestingEmissionPolicy,
} from '@/lib/nesting/policy'
import { getNestingOwlRewardTreasuryKeypair } from '@/lib/nesting/reward-treasury-keypair'
import {
  isPastCouncilLegacyEscrowDepositCutoff,
  getOwlCouncilGovernanceNestingPoolSlug,
} from '@/lib/council/council-stake-migration'
import { getOwlCouncilNestingVoteLockedRaw } from '@/lib/council/council-nesting-stake'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'

export async function executeStake(params: {
  wallet: string
  pool_id: string
  rawAmount: unknown
  rawAssetIdentifier: unknown
  /** Admin-only QA: stake before `NESTING_SELL_OUT_*` gate is cleared. */
  bypassSelloutGate?: boolean
}) {
  const pool_id = params.pool_id.trim()
  if (!STAKING_UUID_RE.test(pool_id)) {
    throw new StakingUserError('Invalid pool_id', 400)
  }

  const pool = await getStakingPoolById(pool_id)
  if (!pool || !pool.is_active) {
    throw new StakingUserError('Pool not found or inactive', 400)
  }
  validatePoolAgainstNestingEmissionPolicy(pool)
  if (!params.bypassSelloutGate) {
    assertNestingSelloutReached()
  }
  if (pool.adapter_mode === 'onchain_enabled' && pool.asset_type === 'nft') {
    assertRewardTreasuryConfigured()
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
  if (pool.asset_type === 'nft' && !asset_identifier) {
    throw new StakingUserError('asset_identifier is required for NFT staking.', 400)
  }
  if (pool.asset_type === 'nft' && asset_identifier) {
    const existing = await getActivePositionByAssetIdentifier(pool.id, asset_identifier)
    if (existing) {
      throw new StakingUserError('This NFT is already in an open staking position.', 400)
    }
  }

  if (pool.minimum_stake != null && amount < Number(pool.minimum_stake)) {
    throw new StakingUserError(`amount below minimum_stake (${pool.minimum_stake})`, 400)
  }
  if (pool.maximum_stake != null && amount > Number(pool.maximum_stake)) {
    throw new StakingUserError(`amount above maximum_stake (${pool.maximum_stake})`, 400)
  }

  const adapter = resolveMutationAdapter(pool)
  const result = await adapter.stakeIntoPool({
    wallet: params.wallet,
    pool,
    amount,
    asset_identifier,
  })
  return { ...result, pool }
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

  if (
    pool.slug === getOwlCouncilGovernanceNestingPoolSlug().toLowerCase() &&
    isPastCouncilLegacyEscrowDepositCutoff()
  ) {
    const owl = getTokenInfo('OWL')
    if (!owl.mintAddress) {
      throw new StakingUserError('OWL is not configured.', 503)
    }
    const lockedRaw = await getOwlCouncilNestingVoteLockedRaw(params.wallet, owl.decimals)
    if (lockedRaw > 0n) {
      throw new StakingUserError(
        'Some OWL in this pool is committed to open Council votes. Wait until those voting windows end, then unstake.',
        400
      )
    }
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

  const stakedAtMs = new Date(row.staked_at).getTime()
  const asOfMs = Date.now()
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

  if (paysOwlRewards && !meetsMinOwlClaimThreshold(claimableNow)) {
    throw new StakingUserError(
      `Claim unlocks once at least ${MIN_OWL_CLAIMABLE_TO_CLAIM} OWL has accrued for this nest.`,
      400,
      { claimable: claimableNow, min_owl: MIN_OWL_CLAIMABLE_TO_CLAIM }
    )
  }

  if (amount > claimableNow + 1e-9) {
    throw new StakingUserError('amount exceeds claimable rewards', 400, { claimable: claimableNow })
  }

  const pool = await getStakingPoolById(row.pool_id)
  if (!pool) {
    throw new StakingUserError('Pool not found', 400)
  }

  const rewardToken = (pool.reward_token ?? '').trim().toUpperCase()
  if (rewardToken === 'OWL' && !isNestingDbOnlyOwlClaimsAllowed()) {
    if (!isOwlEnabled()) {
      throw new StakingUserError(
        'OWL mint is not configured, so reward claims cannot be sent to your wallet.',
        503
      )
    }
    if (!getNestingOwlRewardTreasuryKeypair()) {
      throw new StakingUserError(
        'OWL reward treasury is not configured for on-chain payouts. Set NESTING_OWL_REWARD_TREASURY_WALLET and NESTING_OWL_REWARD_TREASURY_SECRET_KEY to the same keypair, fund that wallet’s OWL token account, and ensure SOL for fees. For local testing without chain transfers, set NESTING_ALLOW_DB_ONLY_OWL_CLAIMS=true.',
        503
      )
    }
  }

  /** Max-claim: align DB with accrued at claim time and transfer exactly what was pending (vs client floor / clock skew). */
  const FULL_CLAIM_EPS = 1e-5
  const isFullClaim = claimableNow > 0 && amount >= claimableNow - FULL_CLAIM_EPS
  const payoutAmount = isFullClaim ? claimableNow : amount
  const newClaimedTotal = isFullClaim ? accruedNow : oldClaimed + amount

  const adapter = resolveMutationAdapter(pool)
  return adapter.claimPositionRewards({
    wallet: params.wallet,
    positionId: position_id,
    amount: payoutAmount,
    newClaimedTotal,
  })
}
