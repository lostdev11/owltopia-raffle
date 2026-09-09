import { getCancellationFeeSol } from '@/lib/config/raffles'
import { updateRaffle } from '@/lib/db/raffles'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import { raffleRequiresCancellationFee } from '@/lib/raffles/cancellation-fee-policy'
import { returnReturnableMilestoneDepositsToCreator } from '@/lib/raffles/milestones/cancel-side-effects'
import type { MilestoneDepositReturnAttempt } from '@/lib/raffles/milestones/cancel-side-effects'
import {
  transferNftPrizeToCreator,
  transferPartnerSplPrizeToCreator,
} from '@/lib/raffles/prize-escrow'
import type { Raffle } from '@/lib/types'

export type FinalizeCancellationResult = {
  success: true
  refundPolicy: 'full_refund' | 'no_refund'
  cancellationFeeAmount: number | null
  cancellationFeeCurrency: string | null
  message: string
  prizeReturnAttempted: boolean
  prizeReturnOk?: boolean
  prizeReturnSignature?: string
  prizeReturnError?: string
  milestoneReturnAttempts: MilestoneDepositReturnAttempt[]
  milestoneReturnsOk: number
  milestoneReturnErrors: Array<{ milestoneId: string; error?: string }>
}

/**
 * Mark raffle cancelled and run prize + milestone escrow returns (shared by accept- and force-cancel).
 */
export async function finalizeRaffleCancellation(params: {
  raffleId: string
  raffle: Raffle
  now?: Date
  /** Admin cancelled without a prior creator request (audit copy only). */
  adminForceCancel?: boolean
}): Promise<FinalizeCancellationResult> {
  const { raffleId, raffle } = params
  const now = params.now ?? new Date()

  const hostPaidFee = !!raffle.cancellation_fee_paid_at
  const feeApplies = raffleRequiresCancellationFee(raffle, now)

  const refundPolicy: 'full_refund' | 'no_refund' = hostPaidFee && feeApplies ? 'no_refund' : 'full_refund'
  const feeSol = getCancellationFeeSol()
  const cancellationFeeAmount = hostPaidFee && feeApplies ? feeSol : null
  const cancellationFeeCurrency = hostPaidFee && feeApplies ? 'SOL' : null

  await updateRaffle(raffleId, {
    status: 'cancelled',
    cancelled_at: now.toISOString(),
    cancellation_requested_at:
      raffle.cancellation_requested_at ?? raffle.cancellation_fee_paid_at ?? now.toISOString(),
    cancellation_refund_policy: refundPolicy,
    cancellation_fee_amount: cancellationFeeAmount,
    cancellation_fee_currency: cancellationFeeCurrency,
    is_active: false,
  })

  try {
    const { markZeroPaymentEntriesRefundedForRaffle } = await import('@/lib/db/entries')
    await markZeroPaymentEntriesRefundedForRaffle(raffleId)
  } catch (e) {
    console.error('[finalize-cancellation] zero-payment refund close:', e)
  }

  let prizeReturnAttempted = false
  let prizeReturnOk: boolean | undefined
  let prizeReturnSignature: string | undefined
  let prizeReturnError: string | undefined

  const escrowReturnKind = raffle.prize_type === 'nft' || isPartnerSplPrizeRaffle(raffle)
  const depositVerified = !!raffle.prize_deposited_at
  const noWinnerTransfer = !(raffle.nft_transfer_transaction ?? '').trim()
  const notYetReturned = !raffle.prize_returned_at

  const shouldTryPrizeReturn =
    escrowReturnKind && depositVerified && noWinnerTransfer && notYetReturned

  if (shouldTryPrizeReturn) {
    prizeReturnAttempted = true
    const returnResult = isPartnerSplPrizeRaffle(raffle)
      ? await transferPartnerSplPrizeToCreator(raffleId, 'cancelled')
      : await transferNftPrizeToCreator(raffleId, 'cancelled')
    prizeReturnOk = returnResult.ok
    prizeReturnSignature = returnResult.signature
    prizeReturnError = returnResult.error
    if (!returnResult.ok && returnResult.error) {
      console.warn(
        `[finalize-cancellation] Prize auto-return failed for raffle ${raffleId}: ${returnResult.error}`
      )
    }
  }

  const milestoneReturnAttempts = await returnReturnableMilestoneDepositsToCreator(raffleId)
  const milestoneReturnsOk = milestoneReturnAttempts.filter((a) => a.ok).length
  const milestoneReturnsFailed = milestoneReturnAttempts.filter((a) => !a.ok)

  const forcePrefix = params.adminForceCancel
    ? 'Admin force-cancelled this milestone raffle (creator had not requested cancellation). '
    : ''

  const baseMessage =
    hostPaidFee && feeApplies
      ? `${forcePrefix}Raffle cancelled. Ticket buyers can claim refunds from the dashboard (funds escrow). The creator paid the ${feeSol} SOL cancellation fee.`
      : feeApplies && !hostPaidFee
        ? `${forcePrefix}Raffle cancelled. Ticket buyers can claim refunds from the dashboard (funds escrow). No verified post-start cancellation fee on file — admin accepted without treasury fee recording.`
        : `${forcePrefix}Raffle cancelled. Ticket buyers can claim refunds from the dashboard (funds escrow). No post-start cancellation fee applied (raffle had not started by scheduled start time).`

  let message = baseMessage
  if (prizeReturnAttempted && prizeReturnOk && prizeReturnSignature) {
    message += ` Prize returned to creator from escrow (TX: ${prizeReturnSignature}).`
  } else if (prizeReturnAttempted && prizeReturnError) {
    message += ` Automatic prize return did not complete: ${prizeReturnError}. Use “Return prize to creator” or “Record manual prize return” in admin if needed.`
  } else if (escrowReturnKind && !depositVerified) {
    message +=
      ' No verified escrow deposit was on file — automatic prize return was skipped (nothing to send from escrow).'
  }

  if (milestoneReturnAttempts.length > 0) {
    if (milestoneReturnsOk === milestoneReturnAttempts.length) {
      message += ` ${milestoneReturnsOk} milestone deposit${milestoneReturnsOk === 1 ? '' : 's'} returned to creator from funds escrow.`
    } else if (milestoneReturnsOk > 0) {
      message += ` ${milestoneReturnsOk}/${milestoneReturnAttempts.length} milestone deposit(s) returned; retry failed bonus returns in admin if needed.`
    } else {
      message +=
        ' Milestone bonus deposits were not returned automatically — use “Return milestone deposit” in admin for each funded bonus.'
    }
  }

  return {
    success: true,
    refundPolicy,
    cancellationFeeAmount,
    cancellationFeeCurrency,
    message,
    prizeReturnAttempted,
    ...(prizeReturnAttempted
      ? {
          prizeReturnOk,
          ...(prizeReturnSignature ? { prizeReturnSignature } : {}),
          ...(prizeReturnError ? { prizeReturnError } : {}),
        }
      : {}),
    milestoneReturnAttempts,
    milestoneReturnsOk,
    milestoneReturnErrors: milestoneReturnsFailed.map((a) => ({
      milestoneId: a.milestoneId,
      error: a.error,
    })),
  }
}
