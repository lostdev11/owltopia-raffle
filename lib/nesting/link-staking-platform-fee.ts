import {
  appendStakingPlatformFeePositionIds,
  getStakingPlatformFeePaymentBySignature,
  insertStakingPlatformFeePayment,
} from '@/lib/db/staking-platform-fee-payments'
import { StakingUserError } from '@/lib/nesting/errors'
import {
  formatStakingPlatformFeePerNestLabel,
  getStakingPlatformFeeLamports,
  isStakingPlatformFeeEnabled,
  type StakingPlatformFeeAction,
} from '@/lib/nesting/staking-platform-fee'
import { verifyStakingPlatformFeeTransaction } from '@/lib/nesting/verify-staking-platform-fee'
import { getPlatformFeeTreasuryWalletAddress } from '@/lib/solana/platform-fee-treasury-wallet'
import { STAKING_UUID_RE } from '@/lib/nesting/validation'

export type StakingPlatformFeeLinkParams = {
  wallet: string
  action: StakingPlatformFeeAction
  feeSignature: unknown
  positionIds: string[]
}

function parseFeeSignature(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function validatePositionIds(positionIds: string[]): string[] {
  const ids = [...new Set(positionIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) {
    throw new StakingUserError('Internal error: nest id missing for platform fee.', 500)
  }
  for (const id of ids) {
    if (!STAKING_UUID_RE.test(id)) {
      throw new StakingUserError('Invalid nest id for platform fee.', 400)
    }
  }
  return ids
}

function parseStakingPlatformFeeLinkParams(params: StakingPlatformFeeLinkParams) {
  if (!isStakingPlatformFeeEnabled()) {
    return null
  }

  const wallet = params.wallet.trim()
  const feeSignature = parseFeeSignature(params.feeSignature)
  const positionIds = validatePositionIds(params.positionIds)
  const feeLabel = formatStakingPlatformFeePerNestLabel()

  if (!feeSignature) {
    throw new StakingUserError(
      `Platform fee required: ${feeLabel} for each nested NFT ${params.action}. Approve the fee in your wallet and try again.`,
      400
    )
  }

  const treasury = getPlatformFeeTreasuryWalletAddress()
  if (!treasury) {
    throw new StakingUserError('Platform fee treasury is not configured.', 503)
  }

  return { wallet, feeSignature, positionIds, treasury, action: params.action }
}

/**
 * Verifies the on-chain platform fee without recording it in the DB.
 * Use before stake/unstake/claim work so a failed payout does not consume the fee link.
 */
export async function validateStakingPlatformFeeLinked(
  params: StakingPlatformFeeLinkParams
): Promise<void> {
  const parsed = parseStakingPlatformFeeLinkParams(params)
  if (!parsed) return

  const { wallet, feeSignature, positionIds, treasury, action } = parsed

  const existing = await getStakingPlatformFeePaymentBySignature(feeSignature)
  if (existing) {
    if (existing.wallet_address !== wallet) {
      throw new StakingUserError('That platform fee transaction belongs to a different wallet.', 400)
    }
    if (existing.action !== action) {
      throw new StakingUserError('That platform fee transaction was used for a different nest action.', 400)
    }

    const linked = new Set(existing.position_ids)
    for (const id of positionIds) {
      if (linked.has(id)) {
        throw new StakingUserError('Platform fee was already recorded for this nest.', 400)
      }
    }
    if (linked.size + positionIds.length > existing.units) {
      throw new StakingUserError(
        `This fee payment covers ${existing.units} nest(s) and ${linked.size} are already linked. Send a new fee transaction.`,
        400
      )
    }
    return
  }

  const verified = await verifyStakingPlatformFeeTransaction({
    signature: feeSignature,
    fromWallet: wallet,
    treasuryWallet: treasury,
    minUnits: positionIds.length,
  })
  if (!verified.ok) {
    throw new StakingUserError(verified.error, 400)
  }

  if (verified.units < positionIds.length) {
    throw new StakingUserError(
      `Platform fee covers ${verified.units} nest(s) but this action needs ${positionIds.length}.`,
      400
    )
  }
}

/**
 * Records a validated platform fee payment after the nest action succeeds.
 */
export async function commitStakingPlatformFeeLinked(params: StakingPlatformFeeLinkParams): Promise<void> {
  const parsed = parseStakingPlatformFeeLinkParams(params)
  if (!parsed) return

  const { wallet, feeSignature, positionIds, treasury, action } = parsed

  const existing = await getStakingPlatformFeePaymentBySignature(feeSignature)
  if (existing) {
    await appendStakingPlatformFeePositionIds(feeSignature, positionIds)
    return
  }

  const verified = await verifyStakingPlatformFeeTransaction({
    signature: feeSignature,
    fromWallet: wallet,
    treasuryWallet: treasury,
    minUnits: positionIds.length,
  })
  if (!verified.ok) {
    throw new StakingUserError(verified.error, 400)
  }

  const expectedUnits = verified.units
  if (expectedUnits < positionIds.length) {
    throw new StakingUserError(
      `Platform fee covers ${expectedUnits} nest(s) but this action needs ${positionIds.length}.`,
      400
    )
  }

  await insertStakingPlatformFeePayment({
    tx_signature: feeSignature,
    wallet_address: wallet,
    action,
    units: expectedUnits,
    lamports: verified.lamports,
    position_ids: positionIds,
  })
}

/**
 * Validates and records an on-chain platform fee payment in one step (stake / unstake / freeze / sync).
 */
export async function requireStakingPlatformFeeLinked(params: StakingPlatformFeeLinkParams): Promise<void> {
  await validateStakingPlatformFeeLinked(params)
  await commitStakingPlatformFeeLinked(params)
}
