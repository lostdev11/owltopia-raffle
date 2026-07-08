import { getGenOwlRevShareClaimForPosition, insertGenOwlRevShareClaim } from '@/lib/db/gen-owl-rev-share-claims'
import type { GenOwlRevSharePeriodRow } from '@/lib/db/gen-owl-rev-share-periods'
import { getStakingPositionForWallet } from '@/lib/db/staking-positions'
import { getStakingPoolById } from '@/lib/db/staking-pools'
import { StakingUserError } from '@/lib/nesting/errors'
import { classifyGen1OneOfOneMints } from '@/lib/nesting/gen1-one-of-one'
import { isPositionEligibleForRevSharePeriod } from '@/lib/nesting/gen-owl-rev-share-eligibility'
import { ensureGenOwlRevSharePeriodFinalized } from '@/lib/nesting/gen-owl-rev-share-finalize'
import { claimsOpenForPeriod, groupKeyForPoolSlug } from '@/lib/nesting/gen-owl-rev-share-month'
import { payoutGenOwlRevShareClaim } from '@/lib/nesting/gen-owl-rev-share-payout'
import { resolveGen1PerNestAmounts } from '@/lib/nesting/gen-owl-rev-share'
import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'

async function perNestAmountsForPosition(
  period: GenOwlRevSharePeriodRow,
  group: GenOwlStakingGroupKey,
  assetIdentifier: string | null
): Promise<{ sol: number; usdc: number }> {
  if (group === 'gen2-owl') {
    return {
      sol: period.gen2_per_nest_sol ?? 0,
      usdc: period.gen2_per_nest_usdc ?? 0,
    }
  }

  const mint = assetIdentifier?.trim()
  if (!mint) {
    return resolveGen1PerNestAmounts(period, 'standard')
  }

  const classification = await classifyGen1OneOfOneMints([mint])
  const bucket = classification.get(mint) === 'one-of-one' ? 'one-of-one' : 'standard'
  return resolveGen1PerNestAmounts(period, bucket)
}

export async function executeGenOwlRevShareClaim(params: {
  wallet: string
  period_month: string
  position_id: string
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

  if (!claimsOpenForPeriod(periodMonth)) {
    throw new StakingUserError(
      'Rev share for this month is not open yet. Claims open on the 1st of the next month (UTC).',
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

  const payout = await payoutGenOwlRevShareClaim({
    wallet,
    amount_sol: amounts.sol,
    amount_usdc: amounts.usdc,
  })

  const payoutFailed =
    payout.payout_errors.length > 0 &&
    ((amounts.sol > 0 && !payout.sol_signature) || (amounts.usdc > 0 && !payout.usdc_signature))

  if (payoutFailed) {
    throw new StakingUserError(
      `Rev share payout could not be sent: ${payout.payout_errors.join(' · ')}. Contact support if this persists.`,
      503
    )
  }

  const claim = await insertGenOwlRevShareClaim({
    period_month: periodMonth,
    position_id: positionId,
    wallet_address: wallet,
    group_key: group,
    amount_sol: amounts.sol,
    amount_usdc: amounts.usdc,
    sol_transaction_signature: payout.sol_signature,
    usdc_transaction_signature: payout.usdc_signature,
  })

  if (!claim) {
    throw new StakingUserError('Could not record rev share claim. Try again.', 500)
  }

  return {
    claim_id: claim.id,
    amount_sol: amounts.sol,
    amount_usdc: amounts.usdc,
    sol_transaction_signature: payout.sol_signature,
    usdc_transaction_signature: payout.usdc_signature,
  }
}
