import {
  appendStakingPlatformFeePositionIds,
  getStakingPlatformFeePaymentBySignature,
  insertStakingPlatformFeePayment,
} from '@/lib/db/staking-platform-fee-payments'
import { StakingUserError } from '@/lib/nesting/errors'
import { findReusableClaimPlatformFeeSignature } from '@/lib/nesting/find-reusable-claim-platform-fee'
import {
  formatEarlyUnstakeFeeLabel,
  formatStakingPlatformFeePerNestLabel,
  getStakingPlatformFeeUnitLamportsForAction,
  isEarlyUnstakeFeeEnabled,
  isStakingPlatformFeeEnabled,
  type StakingPlatformFeeAction,
} from '@/lib/nesting/staking-platform-fee'
import {
  isHardPlatformFeeFailureError,
  isRetryableFeeTxLookupError,
} from '@/lib/nesting/staking-platform-fee-errors'
import { verifyStakingPlatformFeeTransaction } from '@/lib/nesting/verify-staking-platform-fee'
import { getSolanaConnection } from '@/lib/solana/connection'
import { getPlatformFeeTreasuryWalletAddress } from '@/lib/solana/platform-fee-treasury-wallet'
import { MAX_SUPPORTED_TRANSACTION_VERSION } from '@/lib/solana/transaction-version'
import { STAKING_UUID_RE } from '@/lib/nesting/validation'

export type StakingPlatformFeeLinkParams = {
  wallet: string
  action: StakingPlatformFeeAction
  feeSignature: unknown
  positionIds: string[]
  /** When set, on-chain verify uses this instead of `positionIds.length` (Claim all reserve). */
  minUnits?: number
}

function parseFeeSignature(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function validatePositionIds(positionIds: string[], options?: { allowEmpty?: boolean }): string[] {
  const ids = [...new Set(positionIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0 && !options?.allowEmpty) {
    throw new StakingUserError('Internal error: nest id missing for platform fee.', 500)
  }
  for (const id of ids) {
    if (!STAKING_UUID_RE.test(id)) {
      throw new StakingUserError('Invalid nest id for platform fee.', 400)
    }
  }
  return ids
}

function feeMinUnits(parsed: {
  positionIds: string[]
  minUnits?: number
}): number {
  const fromIds = parsed.positionIds.length
  const minUnits =
    typeof parsed.minUnits === 'number' && Number.isFinite(parsed.minUnits)
      ? Math.floor(parsed.minUnits)
      : fromIds
  return Math.max(fromIds, minUnits)
}

function isPlatformFeeActionEnabled(action: StakingPlatformFeeAction): boolean {
  if (action === 'early_unstake') return isEarlyUnstakeFeeEnabled()
  return isStakingPlatformFeeEnabled()
}

function feeLabelForAction(action: StakingPlatformFeeAction): string {
  if (action === 'early_unstake') return formatEarlyUnstakeFeeLabel()
  return formatStakingPlatformFeePerNestLabel(action)
}

function parseStakingPlatformFeeLinkParams(
  params: StakingPlatformFeeLinkParams,
  options?: { allowEmptyPositionIds?: boolean }
) {
  if (!isPlatformFeeActionEnabled(params.action)) {
    return null
  }

  const wallet = params.wallet.trim()
  const feeSignature = parseFeeSignature(params.feeSignature)
  const positionIds = validatePositionIds(params.positionIds, {
    allowEmpty: options?.allowEmptyPositionIds,
  })
  const minUnits = feeMinUnits({ positionIds, minUnits: params.minUnits })
  if (minUnits < 1) {
    throw new StakingUserError('Internal error: platform fee unit count missing.', 500)
  }
  const feeLabel = feeLabelForAction(params.action)

  if (!feeSignature) {
    throw new StakingUserError(
      params.action === 'early_unstake'
        ? `Early leave fee required: ${feeLabel}. Approve the fee in your wallet and try again.`
        : `Platform fee required: ${feeLabel} for each nested NFT ${params.action}. Approve the fee in your wallet and try again.`,
      400
    )
  }

  const treasury = getPlatformFeeTreasuryWalletAddress()
  if (!treasury) {
    throw new StakingUserError('Platform fee treasury is not configured.', 503)
  }

  return {
    wallet,
    feeSignature,
    positionIds,
    minUnits,
    treasury,
    action: params.action,
    unitLamports: getStakingPlatformFeeUnitLamportsForAction(params.action),
  }
}

/**
 * Fast check: is the client-provided fee signature worth keeping, or should we
 * attempt on-chain recovery? Avoids a full verify poll here — validate still
 * does authoritative checks. Returns false when the sig failed on-chain so a
 * stuck localStorage value cannot block recovery of a real unpaid fee.
 */
async function providedClaimFeeLooksUsable(params: {
  wallet: string
  feeSignature: string
  action: Extract<StakingPlatformFeeAction, 'claim' | 'rev_share_claim'>
  positionIds: string[]
  minUnits: number
}): Promise<boolean> {
  const existing = await getStakingPlatformFeePaymentBySignature(params.feeSignature)
  if (existing) {
    if (existing.wallet_address !== params.wallet.trim()) return false
    if (existing.action !== params.action) return false
    const linked = new Set(existing.position_ids)
    const toLink = params.positionIds.filter((id) => !linked.has(id))
    if (toLink.length === 0) return true
    return linked.size + toLink.length <= existing.units
  }

  try {
    const parsed = await getSolanaConnection().getParsedTransaction(params.feeSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
    })
    // Missing: may still be indexing — keep provided and let validate poll.
    // Failed on-chain: do not keep; fall through to recovery.
    if (parsed?.meta?.err) return false
    return true
  } catch {
    // RPC blip — keep provided; validate will poll / error clearly.
    return true
  }
}

/**
 * For claim / rev-share-claim actions: if the client lost the fee signature
 * (mobile redirect / cleared storage), or sent a failed/stale localStorage sig,
 * recover a recent unpaid or spare-capacity fee for this wallet before requiring
 * a new payment.
 */
export async function resolveStakingPlatformFeeSignature(
  params: StakingPlatformFeeLinkParams
): Promise<StakingPlatformFeeLinkParams> {
  if (!isPlatformFeeActionEnabled(params.action)) return params
  if (params.action !== 'claim' && params.action !== 'rev_share_claim') return params

  const provided = parseFeeSignature(params.feeSignature)
  const positionIds = validatePositionIds(params.positionIds, {
    allowEmpty: params.positionIds.length === 0 && (params.minUnits ?? 0) > 0,
  })
  const minUnits = Math.max(1, feeMinUnits({ positionIds, minUnits: params.minUnits }))

  if (provided) {
    const looksUsable = await providedClaimFeeLooksUsable({
      wallet: params.wallet,
      feeSignature: provided,
      action: params.action,
      positionIds,
      minUnits,
    })
    if (looksUsable) return params
  }

  const recovered = await findReusableClaimPlatformFeeSignature({
    wallet: params.wallet,
    minUnits,
    action: params.action,
  })
  if (!recovered) return params
  if (provided && recovered === provided) return params

  return { ...params, feeSignature: recovered }
}

/**
 * Resolve (with recovery) then validate. If a provided signature still fails
 * verify after polling, try recovery once more with an empty signature so a
 * stuck localStorage fee cannot permanently block a good unpaid fee on-chain.
 */
export async function resolveAndValidateStakingPlatformFeeLinked(
  params: StakingPlatformFeeLinkParams
): Promise<StakingPlatformFeeLinkParams> {
  let feeParams = await resolveStakingPlatformFeeSignature(params)
  try {
    await validateStakingPlatformFeeLinked(feeParams)
    return feeParams
  } catch (e) {
    const msg = e instanceof StakingUserError ? e.message : ''
    const provided = parseFeeSignature(params.feeSignature)
    const resolved = parseFeeSignature(feeParams.feeSignature)
    const canRecover =
      Boolean(provided) &&
      resolved === provided &&
      (params.action === 'claim' || params.action === 'rev_share_claim') &&
      (isRetryableFeeTxLookupError(msg) || isHardPlatformFeeFailureError(msg))

    if (!canRecover) throw e

    const positionIds = validatePositionIds(params.positionIds, {
      allowEmpty: params.positionIds.length === 0 && (params.minUnits ?? 0) > 0,
    })
    const minUnits = Math.max(1, feeMinUnits({ positionIds, minUnits: params.minUnits }))
    const recovered = await findReusableClaimPlatformFeeSignature({
      wallet: params.wallet,
      minUnits,
      action: params.action as 'claim' | 'rev_share_claim',
    })
    if (!recovered || recovered === provided) throw e

    feeParams = { ...params, feeSignature: recovered }
    await validateStakingPlatformFeeLinked(feeParams)
    return feeParams
  }
}

/**
 * Verifies the on-chain platform fee without recording it in the DB.
 * Use before stake/unstake/claim work so a failed payout does not consume the fee link.
 */
export async function validateStakingPlatformFeeLinked(
  params: StakingPlatformFeeLinkParams
): Promise<void> {
  const parsed = parseStakingPlatformFeeLinkParams(params, {
    allowEmptyPositionIds: params.positionIds.length === 0 && (params.minUnits ?? 0) > 0,
  })
  if (!parsed) return

  const { wallet, feeSignature, positionIds, minUnits, treasury, action, unitLamports } = parsed

  const existing = await getStakingPlatformFeePaymentBySignature(feeSignature)
  if (existing) {
    if (existing.wallet_address !== wallet) {
      throw new StakingUserError('That platform fee transaction belongs to a different wallet.', 400)
    }
    if (existing.action !== action) {
      throw new StakingUserError('That platform fee transaction was used for a different nest action.', 400)
    }

    // Idempotent: retries after a successful link (lost response, mobile blip, "Finish opening")
    // must not fail with "already recorded" — that traps nests after the fee is paid.
    const linked = new Set(existing.position_ids)
    const toLink = positionIds.filter((id) => !linked.has(id))
    if (toLink.length === 0) {
      return
    }
    if (linked.size + toLink.length > existing.units) {
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
    minUnits,
    unitLamports,
  })
  if (!verified.ok) {
    throw new StakingUserError(verified.error, 400)
  }

  if (verified.units < minUnits) {
    throw new StakingUserError(
      `Platform fee covers ${verified.units} nest(s) but this action needs ${minUnits}.`,
      400
    )
  }
}

/**
 * After on-chain validation, record the fee payment with no nests linked yet.
 * Claim all appends nest ids per batch as OWL is sent.
 */
export async function reserveStakingPlatformFeeLinked(
  params: StakingPlatformFeeLinkParams
): Promise<void> {
  const parsed = parseStakingPlatformFeeLinkParams(params, { allowEmptyPositionIds: true })
  if (!parsed) return

  const { wallet, feeSignature, minUnits, treasury, action, unitLamports } = parsed

  const existing = await getStakingPlatformFeePaymentBySignature(feeSignature)
  if (existing) {
    if (existing.wallet_address !== wallet) {
      throw new StakingUserError('That platform fee transaction belongs to a different wallet.', 400)
    }
    if (existing.action !== action) {
      throw new StakingUserError('That platform fee transaction was used for a different nest action.', 400)
    }
    if (existing.units < minUnits) {
      throw new StakingUserError(
        `This fee payment covers ${existing.units} nest(s) but Claim all needs ${minUnits}.`,
        400
      )
    }
    return
  }

  const verified = await verifyStakingPlatformFeeTransaction({
    signature: feeSignature,
    fromWallet: wallet,
    treasuryWallet: treasury,
    minUnits,
    unitLamports,
  })
  if (!verified.ok) {
    throw new StakingUserError(verified.error, 400)
  }

  if (verified.units < minUnits) {
    throw new StakingUserError(
      `Platform fee covers ${verified.units} nest(s) but this action needs ${minUnits}.`,
      400
    )
  }

  await insertStakingPlatformFeePayment({
    tx_signature: feeSignature,
    wallet_address: wallet,
    action,
    units: verified.units,
    lamports: verified.lamports,
    position_ids: [],
  })
}

/**
 * Records a validated platform fee payment after the nest action succeeds.
 */
export async function commitStakingPlatformFeeLinked(params: StakingPlatformFeeLinkParams): Promise<void> {
  const parsed = parseStakingPlatformFeeLinkParams(params)
  if (!parsed) return

  const { wallet, feeSignature, positionIds, minUnits, treasury, action, unitLamports } = parsed

  const existing = await getStakingPlatformFeePaymentBySignature(feeSignature)
  if (existing) {
    await appendStakingPlatformFeePositionIds(feeSignature, positionIds)
    return
  }

  const verified = await verifyStakingPlatformFeeTransaction({
    signature: feeSignature,
    fromWallet: wallet,
    treasuryWallet: treasury,
    minUnits: Math.max(minUnits, positionIds.length),
    unitLamports,
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
