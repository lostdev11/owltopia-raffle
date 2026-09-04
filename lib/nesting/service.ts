/**
 * Owl Nesting application layer — validates inputs then delegates to a staking adapter.
 */

import { getStakingPoolById } from '@/lib/db/staking-pools'
import type { RewardRateUnit, StakingPoolRow } from '@/lib/db/staking-pools'
import {
  getActivePositionByAssetIdentifier,
  getStakingPositionById,
  getStakingPositionForWallet,
  listStakingPositionsByWallet,
} from '@/lib/db/staking-positions'
import {
  estimateAccruedRewards,
  isValidOwlClaimPayoutAmount,
  meetsMinOwlClaimThreshold,
  MIN_OWL_CLAIMABLE_TO_CLAIM,
} from '@/lib/staking/rewards'
import {
  buildFullPositionClaimPlan,
  buildOwlClaimAllPreview,
  isOwlRewardPosition,
  minOwlClaimPayoutRejectedMessage,
  minOwlClaimThresholdMessage,
  noClaimableRewardsMessage,
} from '@/lib/nesting/claim-plan'
import { executeChunkedBatchOwlClaims } from '@/lib/nesting/chunked-claim-all'
import { StakingUserError } from '@/lib/nesting/errors'
import { resolveMutationAdapter } from '@/lib/nesting/resolve-adapter'
import { STAKING_UUID_RE } from '@/lib/nesting/validation'
import { executeUnstakeAdminOverrideByWallet } from '@/lib/nesting/admin-unstake-override'
import {
  assertNestingClaimsAllowed,
  assertNestingOperationsAllowed,
  assertNestingSelloutReached,
  assertRewardTreasuryConfigured,
  isNestingClaimAllDisabled,
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
import { isOpeningNftNestAbortable } from '@/lib/nesting/position-lifecycle'
import {
  assertActiveNftNestOnChainLock,
  partitionClaimAllNestsByLockEligibility,
  assertPoolConfiguredForOnChainNftFreeze,
} from '@/lib/nesting/nft-nest-onchain-lock'
import { assertAdminOnlyStakingPoolAccess } from '@/lib/nesting/gen1-staking-pools'
import { tryClearCrossWalletBlockerForMint } from '@/lib/nesting/clear-cross-wallet-stale-nests'
import { assertNftEligibleForPoolStake } from '@/lib/nesting/nft-lock-service'
import {
  commitStakingPlatformFeeLinked,
  requireStakingPlatformFeeLinked,
  resolveStakingPlatformFeeSignature,
  validateStakingPlatformFeeLinked,
} from '@/lib/nesting/link-staking-platform-fee'

export async function executeStake(params: {
  wallet: string
  pool_id: string
  rawAmount: unknown
  rawAssetIdentifier: unknown
  /** Admin-only QA: stake before `NESTING_SELL_OUT_*` gate is cleared. */
  bypassSelloutGate?: boolean
  platform_fee_signature?: unknown
}) {
  const pool_id = params.pool_id.trim()
  if (!STAKING_UUID_RE.test(pool_id)) {
    throw new StakingUserError('Invalid pool_id', 400)
  }

  const { ensureTieredOwlStakingPoolsReady } = await import('@/lib/nesting/gen1-staking-pools')
  await ensureTieredOwlStakingPoolsReady()

  const pool = await getStakingPoolById(pool_id)
  if (!pool || !pool.is_active) {
    throw new StakingUserError('Pool not found or inactive', 400)
  }
  validatePoolAgainstNestingEmissionPolicy(pool)
  assertPoolConfiguredForOnChainNftFreeze(pool)
  await assertAdminOnlyStakingPoolAccess(pool, params.wallet)

  let amount =
    params.rawAmount !== undefined && params.rawAmount !== null ? Number(params.rawAmount) : NaN
  if (pool.asset_type === 'nft') {
    // One DB position per NFT; reward math is `rate × amount × time` — amount must stay 1 per NFT.
    // Multiple nests come from multiple `asset_identifier` stakes (UI loops), not from this field.
    amount = 1
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
      await tryClearCrossWalletBlockerForMint({
        holderWallet: params.wallet,
        poolId: pool.id,
        assetMint: asset_identifier,
      })
      const existing = await getActivePositionByAssetIdentifier(pool.id, asset_identifier)
      if (existing) {
        const nftFreezeConfirmed = Boolean(existing.external_reference?.startsWith('nft_freeze_confirmed:'))
        const resumeNftFreezeLock =
          existing.status === 'pending' &&
          !nftFreezeConfirmed &&
          existing.wallet_address.trim() === params.wallet.trim() &&
          (pool.adapter_mode === 'onchain_enabled' ||
            (existing.external_reference ?? '').trim() === 'awaiting_nft_freeze')

        if (resumeNftFreezeLock) {
          return { position: existing, pool }
        }
        throw new StakingUserError('This NFT is already in an open staking position.', 400)
      }
      await assertNftEligibleForPoolStake({
        pool,
        assetId: asset_identifier,
        ownerWallet: params.wallet,
      })
    }

  await assertNestingOperationsAllowed()
  if (!params.bypassSelloutGate) {
    assertNestingSelloutReached()
  }
  if (pool.adapter_mode === 'onchain_enabled' && pool.asset_type === 'nft') {
    assertRewardTreasuryConfigured()
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

  if (result.position.status === 'active') {
    await requireStakingPlatformFeeLinked({
      wallet: params.wallet,
      action: 'stake',
      feeSignature: params.platform_fee_signature,
      positionIds: [result.position.id],
    })
  }

  return { ...result, pool }
}

export async function executeUnstake(params: {
  wallet: string
  position_id: string
  platform_fee_signature?: unknown
}) {
  const position_id = params.position_id.trim()
  if (!STAKING_UUID_RE.test(position_id)) {
    throw new StakingUserError('Invalid position_id', 400)
  }

  const existing = await getStakingPositionForWallet(position_id, params.wallet)
  if (!existing) {
    throw new StakingUserError('Position not found', 404)
  }

  const pool = await getStakingPoolById(existing.pool_id)
  if (!pool) {
    throw new StakingUserError('Pool not found', 400)
  }

  const openingNftNestAbortable = isOpeningNftNestAbortable(existing, pool)

  if (existing.status !== 'active' && !openingNftNestAbortable) {
    throw new StakingUserError('Position is not active', 400)
  }

  if (!openingNftNestAbortable) {
    await assertNestingOperationsAllowed()
  }

  if (existing.status === 'active') {
    await assertActiveNftNestOnChainLock(existing, pool, {
      repairMissingFreeze: true,
      requireSoftOwnership: false,
    })
  }

  if (existing.status === 'active' && existing.unlock_at) {
    const unlockMs = new Date(existing.unlock_at).getTime()
    if (!Number.isNaN(unlockMs) && Date.now() < unlockMs) {
      throw new StakingUserError('Lock period not ended', 400, {
        unlock_at: existing.unlock_at,
      })
    }
  }

  if (
    existing.status === 'active' &&
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
  await requireStakingPlatformFeeLinked({
    wallet: params.wallet,
    action: 'unstake',
    feeSignature: params.platform_fee_signature,
    positionIds: [position_id],
  })
  return adapter.unstakePosition({
    wallet: params.wallet,
    positionId: position_id,
  })
}

/**
 * Full-admin support: close any open nest by `staking_positions.id` for the holder wallet on that row.
 * Skips lock timer, council vote lock, and {@link assertNestingOperationsAllowed} so ops can recover users
 * during incidents or `NESTING_DISABLED` (on-chain thaw / vault return still runs when configured).
 */
export async function executeUnstakeAdminOverride(params: { position_id: string }) {
  const position_id = params.position_id.trim()
  if (!STAKING_UUID_RE.test(position_id)) {
    throw new StakingUserError('Invalid position_id', 400)
  }

  const existing = await getStakingPositionById(position_id)
  if (!existing) {
    throw new StakingUserError('Position not found', 404)
  }

  const pool = await getStakingPoolById(existing.pool_id)
  if (!pool) {
    throw new StakingUserError('Pool not found', 400)
  }

  const openingNftNestAbortable = isOpeningNftNestAbortable(existing, pool)

  if (existing.status !== 'active' && !openingNftNestAbortable) {
    throw new StakingUserError('Position is not active', 400)
  }

  const holderWallet = existing.wallet_address.trim()
  // #region agent log
  try {
    const fs = await import('fs')
    fs.appendFileSync(
      '/opt/cursor/logs/debug.log',
      JSON.stringify({
        location: 'service.ts:executeUnstakeAdminOverride:entry',
        message: 'admin override unstake one',
        data: {
          position_id,
          holderWallet,
          pool_id: pool.id,
          pool_slug: pool.slug,
          asset_type: pool.asset_type,
          adapter_mode: pool.adapter_mode,
          nft_lock_standard: (pool as { nft_lock_standard?: string | null }).nft_lock_standard ?? null,
          status: existing.status,
          asset_identifier: existing.asset_identifier,
          external_reference: existing.external_reference,
          openingNftNestAbortable,
        },
        timestamp: Date.now(),
        hypothesisId: 'D',
      }) + '\n'
    )
  } catch {
    /* debug log best-effort */
  }
  // #endregion
  const adapter = resolveMutationAdapter(pool)
  try {
    const result = await adapter.unstakePosition({
      wallet: holderWallet,
      positionId: position_id,
      adminRecoveryUnstake: true,
    })
    // #region agent log
    try {
      const fs = await import('fs')
      fs.appendFileSync(
        '/opt/cursor/logs/debug.log',
        JSON.stringify({
          location: 'service.ts:executeUnstakeAdminOverride:ok',
          message: 'admin override unstake one ok',
          data: {
            position_id,
            unstake_signature: result.position?.unstake_signature ?? null,
          },
          timestamp: Date.now(),
          hypothesisId: 'E',
        }) + '\n'
      )
    } catch {
      /* debug log best-effort */
    }
    // #endregion
    return result
  } catch (e) {
    // #region agent log
    try {
      const fs = await import('fs')
      fs.appendFileSync(
        '/opt/cursor/logs/debug.log',
        JSON.stringify({
          location: 'service.ts:executeUnstakeAdminOverride:err',
          message: 'admin override unstake one threw',
          data: {
            position_id,
            asset_identifier: existing.asset_identifier,
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : typeof e,
          },
          timestamp: Date.now(),
          hypothesisId: 'A',
        }) + '\n'
      )
    } catch {
      /* debug log best-effort */
    }
    // #endregion
    throw e
  }
}

/**
 * Full-admin support: force-leave eligible open nests for a holder wallet (oldest first, bounded batch).
 * Same per-nest path as {@link executeUnstakeAdminOverride}.
 */
export async function executeUnstakeAdminOverrideForWallet(params: {
  wallet_address: string
  limit?: number
}) {
  return executeUnstakeAdminOverrideByWallet({
    wallet_address: params.wallet_address,
    limit: params.limit,
    unstakeOne: (position_id) => executeUnstakeAdminOverride({ position_id }),
  })
}

export async function executeClaim(params: {
  wallet: string
  position_id: string
  rawAmount: unknown
  platform_fee_signature?: unknown
}) {
  assertNestingClaimsAllowed()
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

  const pool = await getStakingPoolById(row.pool_id)
  if (!pool) {
    throw new StakingUserError('Pool not found', 400)
  }
  await assertActiveNftNestOnChainLock(row, pool, {
    allowOwnerThawedForClaim: true,
    closeSoftNestIfSold: true,
  })

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
    throw new StakingUserError(minOwlClaimThresholdMessage(), 400, {
      claimable: claimableNow,
      min_owl: MIN_OWL_CLAIMABLE_TO_CLAIM,
    })
  }

  if (!paysOwlRewards && claimableNow <= 1e-12) {
    throw new StakingUserError('No rewards to claim yet for this nest.', 400, { claimable: claimableNow })
  }

  if (amount > claimableNow + 1e-9) {
    throw new StakingUserError('amount exceeds claimable rewards', 400, { claimable: claimableNow })
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
  if (rewardToken && rewardToken !== 'OWL') {
    const { isPartnerTokenRewardPool, getPartnerNestRewardVaultKeypair } = await import(
      '@/lib/nesting/partner-reward-vault'
    )
    const { partnerRewardAvailableUi } = await import('@/lib/db/staking-pools')
    if (isPartnerTokenRewardPool(pool)) {
      if (!getPartnerNestRewardVaultKeypair()) {
        throw new StakingUserError(
          'Partner reward payouts are not configured yet (Nesting reward vault keypair missing).',
          503
        )
      }
      const available = partnerRewardAvailableUi(pool)
      if (amount > available + 1e-9) {
        throw new StakingUserError(
          `This nest’s partner reward pool needs more deposits before you can claim (available ${available}).`,
          400,
          { available, requested: amount }
        )
      }
    }
  }

  /** Max-claim: align DB with accrued at claim time and transfer exactly what was pending (vs client floor / clock skew). */
  const FULL_CLAIM_EPS = 1e-5
  const isFullClaim = claimableNow > 0 && amount >= claimableNow - FULL_CLAIM_EPS
  const payoutAmount = isFullClaim ? claimableNow : amount
  const newClaimedTotal = isFullClaim ? accruedNow : oldClaimed + amount

  if (paysOwlRewards && !isValidOwlClaimPayoutAmount(payoutAmount)) {
    throw new StakingUserError(minOwlClaimPayoutRejectedMessage(payoutAmount), 400, {
      payout: payoutAmount,
      claimable: claimableNow,
      min_owl: MIN_OWL_CLAIMABLE_TO_CLAIM,
    })
  }

  const feeParams = await resolveStakingPlatformFeeSignature({
    wallet: params.wallet,
    action: 'claim' as const,
    feeSignature: params.platform_fee_signature,
    positionIds: [position_id],
  })
  await validateStakingPlatformFeeLinked(feeParams)

  const adapter = resolveMutationAdapter(pool)
  const result = await adapter.claimPositionRewards({
    wallet: params.wallet,
    positionId: position_id,
    amount: payoutAmount,
    newClaimedTotal,
  })

  await commitStakingPlatformFeeLinked(feeParams)
  return result
}

/** Claim pending OWL from every active nest in one request (one on-chain transfer when configured). */
export async function executeClaimAll(params: {
  wallet: string
  platform_fee_signature?: unknown
}) {
  assertNestingClaimsAllowed()

  if (isNestingClaimAllDisabled()) {
    throw new StakingUserError(
      'Claim all is temporarily unavailable. Claim from each nest individually, or try again later.',
      503
    )
  }

  const rows = await listStakingPositionsByWallet(params.wallet)
  const asOfMs = Date.now()
  const { plans, ready: claimAllReady } = buildOwlClaimAllPreview(rows, asOfMs)
  const owlRows = rows.filter((r) => r.status === 'active' && isOwlRewardPosition(r))

  if (plans.length === 0 || !claimAllReady) {
    throw new StakingUserError(
      noClaimableRewardsMessage(),
      400,
      { claimable_count: 0 }
    )
  }

  const pool = await getStakingPoolById(owlRows[0]!.pool_id)
  if (!pool) {
    throw new StakingUserError('Pool not found', 400)
  }

  const planPositionIds = new Set(plans.map((p) => p.positionId))
  const rowsToVerify = owlRows.filter((row) => planPositionIds.has(row.id))
  const poolById = new Map<string, StakingPoolRow>()
  poolById.set(pool.id, pool)

  const missingPoolIds = [
    ...new Set(rowsToVerify.map((row) => row.pool_id).filter((id) => !poolById.has(id))),
  ]
  if (missingPoolIds.length > 0) {
    const loaded = await Promise.all(missingPoolIds.map((id) => getStakingPoolById(id)))
    for (let i = 0; i < missingPoolIds.length; i++) {
      const rowPool = loaded[i]
      if (rowPool) poolById.set(missingPoolIds[i]!, rowPool)
    }
  }

  const lockPartition = await partitionClaimAllNestsByLockEligibility(rowsToVerify, poolById)
  const eligibleIds = new Set(lockPartition.eligible.map((r) => r.id))
  const claimPlans = plans.filter((p) => eligibleIds.has(p.positionId))
  const skippedLocks = lockPartition.skipped

  if (claimPlans.length === 0) {
    const sample = skippedLocks[0]?.message?.trim()
    throw new StakingUserError(
      sample
        ? `${sample}${
            skippedLocks.length > 1
              ? ` (${skippedLocks.length} nests need a restored lock — Finish opening or contact support.)`
              : ''
          }`
        : 'None of your claimable nests have a valid on-chain lock. Finish opening those nests, or contact support.',
      400,
      {
        code: 'claim_all_no_eligible_locks',
        skipped_count: skippedLocks.length,
        skipped_position_ids: skippedLocks.map((s) => s.positionId),
      }
    )
  }

  const claimableTotal = claimPlans.reduce((sum, p) => sum + p.payoutAmount, 0)
  if (!meetsMinOwlClaimThreshold(claimableTotal)) {
    throw new StakingUserError(
      `After skipping ${skippedLocks.length} unlocked nest(s), only ${claimableTotal.toLocaleString(undefined, { maximumFractionDigits: 6 })} OWL remains claimable (need at least ${MIN_OWL_CLAIMABLE_TO_CLAIM} OWL). Finish opening those nests, then Claim all again — your platform fee can be reused.`,
      400,
      {
        code: 'claim_all_below_min_after_lock_skip',
        skipped_count: skippedLocks.length,
        claimable_after_skip: claimableTotal,
        skipped_position_ids: skippedLocks.map((s) => s.positionId),
      }
    )
  }

  const feeParams = await resolveStakingPlatformFeeSignature({
    wallet: params.wallet,
    action: 'claim' as const,
    feeSignature: params.platform_fee_signature,
    positionIds: claimPlans.map((p) => p.positionId),
  })
  await validateStakingPlatformFeeLinked(feeParams)

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

  try {
    const result = await executeChunkedBatchOwlClaims({
      wallet: params.wallet,
      pool,
      plans: claimPlans,
    })

    await commitStakingPlatformFeeLinked(feeParams)
    return {
      ...result,
      skipped_lock_count: skippedLocks.length,
      skipped_locks: skippedLocks.map((s) => ({
        position_id: s.positionId,
        asset_id: s.assetId,
        reason: s.message,
      })),
    }
  } catch (e) {
    // Partial Claim-all already sent OWL for some batches: still record the fee for completed
    // nests so a retry can append remaining ids to the same payment instead of charging again.
    if (e instanceof StakingUserError && e.extra?.code === 'claim_all_partial_batch') {
      const completed = Array.isArray(e.extra.completed_position_ids)
        ? e.extra.completed_position_ids.filter((id): id is string => typeof id === 'string')
        : []
      if (completed.length > 0) {
        await commitStakingPlatformFeeLinked({
          ...feeParams,
          positionIds: completed,
        }).catch(() => {})
      }
    }
    throw e
  }
}
