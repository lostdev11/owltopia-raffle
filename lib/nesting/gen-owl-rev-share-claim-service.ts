import {
  deleteGenOwlRevShareClaim,
  deleteGenOwlRevShareClaims,
  getGenOwlRevShareClaimForPosition,
  insertGenOwlRevShareClaim,
  updateGenOwlRevShareClaimSignatures,
  updateGenOwlRevShareClaimSignaturesForIds,
} from '@/lib/db/gen-owl-rev-share-claims'
import type { GenOwlRevSharePeriodRow } from '@/lib/db/gen-owl-rev-share-periods'
import { getStakingPositionForWallet } from '@/lib/db/staking-positions'
import { getStakingPoolById } from '@/lib/db/staking-pools'
import { StakingUserError } from '@/lib/nesting/errors'
import { classifyGen1OneOfOneMints } from '@/lib/nesting/gen1-one-of-one'
import { classifyGen2OneOfOneMints } from '@/lib/nesting/gen2-one-of-one'
import { isPositionEligibleForRevSharePeriod } from '@/lib/nesting/gen-owl-rev-share-eligibility'
import { ensureGenOwlRevSharePeriodFinalized } from '@/lib/nesting/gen-owl-rev-share-finalize'
import { listGenOwlRevShareClaimableForWallet } from '@/lib/nesting/gen-owl-rev-share-claimable'
import { claimsOpenForPeriod, groupKeyForPoolSlug } from '@/lib/nesting/gen-owl-rev-share-month'
import { payoutGenOwlRevShareClaim } from '@/lib/nesting/gen-owl-rev-share-payout'
import { resolveGen1PerNestAmounts, resolveGen2PerNestAmounts } from '@/lib/nesting/gen-owl-rev-share'
import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'
import { areGenOwlRevShareClaimsEnabled } from '@/lib/db/rev-share-schedule'
import {
  commitStakingPlatformFeeLinked,
  validateStakingPlatformFeeLinked,
} from '@/lib/nesting/link-staking-platform-fee'

async function perNestAmountsForPosition(
  period: GenOwlRevSharePeriodRow,
  group: GenOwlStakingGroupKey,
  assetIdentifier: string | null
): Promise<{ sol: number; usdc: number }> {
  const mint = assetIdentifier?.trim()
  if (group === 'gen2-owl') {
    if (!mint) return resolveGen2PerNestAmounts(period, 'standard')
    const classification = await classifyGen2OneOfOneMints([mint])
    const bucket = classification.get(mint) === 'one-of-one' ? 'one-of-one' : 'standard'
    return resolveGen2PerNestAmounts(period, bucket)
  }

  if (!mint) {
    return resolveGen1PerNestAmounts(period, 'standard')
  }

  const classification = await classifyGen1OneOfOneMints([mint])
  const bucket = classification.get(mint) === 'one-of-one' ? 'one-of-one' : 'standard'
  return resolveGen1PerNestAmounts(period, bucket)
}

function feeParamsForRevShareClaim(wallet: string, feeSignature: unknown, positionIds: string[]) {
  return {
    wallet,
    action: 'rev_share_claim' as const,
    feeSignature,
    positionIds,
  }
}

export async function executeGenOwlRevShareClaim(params: {
  wallet: string
  period_month: string
  position_id: string
  platform_fee_signature?: unknown
}): Promise<{
  claim_id: string
  amount_sol: number
  amount_usdc: number
  sol_transaction_signature: string | null
  usdc_transaction_signature: string | null
}> {
  const periodMonth = params.period_month.trim()
  const positionId = params.position_id.trim()
  const wallet = params.wallet.trim()

  if (!(await areGenOwlRevShareClaimsEnabled())) {
    throw new StakingUserError(
      'Rev share claims are temporarily paused by an admin. Your share stays stacked — try again later.',
      503
    )
  }

  if (!claimsOpenForPeriod(periodMonth)) {
    throw new StakingUserError(
      'Rev share for this month is not open yet. Claims open on the last day of the month (UTC).',
      400
    )
  }

  const period = await ensureGenOwlRevSharePeriodFinalized(periodMonth)
  if (!period?.finalized_at) {
    throw new StakingUserError('Rev share pool for this month is not configured yet.', 404)
  }

  const existing = await getGenOwlRevShareClaimForPosition(periodMonth, positionId)
  if (existing) {
    throw new StakingUserError('Rev share for this nest and month was already claimed.', 409)
  }

  const position = await getStakingPositionForWallet(positionId, wallet)
  if (!position) {
    throw new StakingUserError('Nest not found for this wallet.', 404)
  }

  if (!isPositionEligibleForRevSharePeriod(position, periodMonth)) {
    throw new StakingUserError('This nest was not eligible for rev share in that month.', 400)
  }

  const pool = await getStakingPoolById(position.pool_id)
  const group = groupKeyForPoolSlug(pool?.slug)
  if (!group) {
    throw new StakingUserError('This nest is not on a Gen 1 / Gen 2 rev share perch.', 400)
  }

  const amounts = await perNestAmountsForPosition(period, group, position.asset_identifier)
  if (amounts.sol <= 0 && amounts.usdc <= 0) {
    throw new StakingUserError('No rev share amount configured for this generation this month.', 400)
  }

  const feeParams = feeParamsForRevShareClaim(wallet, params.platform_fee_signature, [positionId])
  await validateStakingPlatformFeeLinked(feeParams)

  // Reserve unique claim row BEFORE payout so concurrent requests cannot double-pay.
  const reserved = await insertGenOwlRevShareClaim({
    period_month: periodMonth,
    position_id: positionId,
    wallet_address: wallet,
    group_key: group,
    amount_sol: amounts.sol,
    amount_usdc: amounts.usdc,
    sol_transaction_signature: null,
    usdc_transaction_signature: null,
  })
  if (!reserved.ok) {
    if (reserved.reason === 'duplicate') {
      throw new StakingUserError('Rev share for this nest and month was already claimed.', 409)
    }
    throw new StakingUserError('Could not reserve rev share claim. Try again.', 500)
  }

  const payout = await payoutGenOwlRevShareClaim({
    wallet,
    amount_sol: amounts.sol,
    amount_usdc: amounts.usdc,
  })

  const needSol = amounts.sol > 0
  const needUsdc = amounts.usdc > 0
  const solOk = !needSol || Boolean(payout.sol_signature)
  const usdcOk = !needUsdc || Boolean(payout.usdc_signature)
  const anyPaid = Boolean(payout.sol_signature || payout.usdc_signature)

  if (!anyPaid) {
    await deleteGenOwlRevShareClaim(reserved.claim.id)
    throw new StakingUserError(
      `Rev share payout could not be sent: ${payout.payout_errors.join(' · ') || 'unknown error'}. Try again.`,
      503
    )
  }

  const updated = await updateGenOwlRevShareClaimSignatures({
    id: reserved.claim.id,
    sol_transaction_signature: payout.sol_signature,
    usdc_transaction_signature: payout.usdc_signature,
  })
  if (!updated) {
    throw new StakingUserError(
      'Payout may have been sent but claim record failed to update. Contact support with your wallet and nest id.',
      500
    )
  }

  await commitStakingPlatformFeeLinked(feeParams)

  if (!solOk || !usdcOk) {
    throw new StakingUserError(
      `Partial rev share payout recorded (${[
        payout.sol_signature ? 'SOL sent' : needSol ? 'SOL failed' : null,
        payout.usdc_signature ? 'USDC sent' : needUsdc ? 'USDC failed' : null,
      ]
        .filter(Boolean)
        .join(', ')}). This nest is locked — contact support; do not retry.`,
      503
    )
  }

  return {
    claim_id: updated.id,
    amount_sol: amounts.sol,
    amount_usdc: amounts.usdc,
    sol_transaction_signature: payout.sol_signature,
    usdc_transaction_signature: payout.usdc_signature,
  }
}

/**
 * Claim every pending Gen nest rev-share row for the wallet in one pooled payout.
 * Requires a wallet-signed platform fee of 0.001 SOL × nest count (when fees are enabled).
 */
export async function executeGenOwlRevShareClaimAll(params: {
  wallet: string
  platform_fee_signature?: unknown
}): Promise<{
  claim_count: number
  amount_sol: number
  amount_usdc: number
  sol_transaction_signature: string | null
  usdc_transaction_signature: string | null
  claim_ids: string[]
}> {
  const wallet = params.wallet.trim()

  if (!(await areGenOwlRevShareClaimsEnabled())) {
    throw new StakingUserError(
      'Rev share claims are temporarily paused by an admin. Your share stays stacked — try again later.',
      503
    )
  }

  const pending = (await listGenOwlRevShareClaimableForWallet(wallet)).filter((r) => !r.already_claimed)
  if (pending.length === 0) {
    throw new StakingUserError('Nothing to claim right now.', 400)
  }

  const positionIds = pending.map((r) => r.position_id)
  const feeParams = feeParamsForRevShareClaim(wallet, params.platform_fee_signature, positionIds)
  await validateStakingPlatformFeeLinked(feeParams)

  const reservedIds: string[] = []
  let totalSol = 0
  let totalUsdc = 0

  try {
    for (const row of pending) {
      const reserved = await insertGenOwlRevShareClaim({
        period_month: row.period_month,
        position_id: row.position_id,
        wallet_address: wallet,
        group_key: row.group,
        amount_sol: row.amount_sol,
        amount_usdc: row.amount_usdc,
        sol_transaction_signature: null,
        usdc_transaction_signature: null,
      })
      if (!reserved.ok) {
        if (reserved.reason === 'duplicate') {
          throw new StakingUserError(
            'One of these nests was already claimed. Refresh and try again.',
            409
          )
        }
        throw new StakingUserError('Could not reserve rev share claim. Try again.', 500)
      }
      reservedIds.push(reserved.claim.id)
      totalSol += row.amount_sol
      totalUsdc += row.amount_usdc
    }
  } catch (e) {
    if (reservedIds.length > 0) {
      await deleteGenOwlRevShareClaims(reservedIds)
    }
    throw e
  }

  if (totalSol <= 0 && totalUsdc <= 0) {
    await deleteGenOwlRevShareClaims(reservedIds)
    throw new StakingUserError('No rev share amount configured for these nests.', 400)
  }

  const payout = await payoutGenOwlRevShareClaim({
    wallet,
    amount_sol: totalSol,
    amount_usdc: totalUsdc,
  })

  const needSol = totalSol > 0
  const needUsdc = totalUsdc > 0
  const solOk = !needSol || Boolean(payout.sol_signature)
  const usdcOk = !needUsdc || Boolean(payout.usdc_signature)
  const anyPaid = Boolean(payout.sol_signature || payout.usdc_signature)

  if (!anyPaid) {
    await deleteGenOwlRevShareClaims(reservedIds)
    throw new StakingUserError(
      `Rev share payout could not be sent: ${payout.payout_errors.join(' · ') || 'unknown error'}. Try again.`,
      503
    )
  }

  const updatedCount = await updateGenOwlRevShareClaimSignaturesForIds({
    ids: reservedIds,
    sol_transaction_signature: payout.sol_signature,
    usdc_transaction_signature: payout.usdc_signature,
  })
  if (updatedCount < reservedIds.length) {
    throw new StakingUserError(
      'Payout may have been sent but claim records failed to update. Contact support with your wallet.',
      500
    )
  }

  await commitStakingPlatformFeeLinked(feeParams)

  if (!solOk || !usdcOk) {
    throw new StakingUserError(
      `Partial rev share payout recorded (${[
        payout.sol_signature ? 'SOL sent' : needSol ? 'SOL failed' : null,
        payout.usdc_signature ? 'USDC sent' : needUsdc ? 'USDC failed' : null,
      ]
        .filter(Boolean)
        .join(', ')}). These nests are locked — contact support; do not retry.`,
      503
    )
  }

  return {
    claim_count: reservedIds.length,
    amount_sol: totalSol,
    amount_usdc: totalUsdc,
    sol_transaction_signature: payout.sol_signature,
    usdc_transaction_signature: payout.usdc_signature,
    claim_ids: reservedIds,
  }
}
