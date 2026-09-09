import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { getCancellationFeeSol } from '@/lib/config/raffles'
import { raffleRequiresCancellationFee } from '@/lib/raffles/cancellation-fee-policy'
import {
  transferNftPrizeToCreator,
  transferPartnerSplPrizeToCreator,
} from '@/lib/raffles/prize-escrow'
import { returnReturnableMilestoneDepositsToCreator } from '@/lib/raffles/milestones/cancel-side-effects'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/accept-cancellation
 * Full admin accepts a cancellation request. Creators who started the raffle are normally expected to pay the
 * on-chain cancellation fee first; admins may still accept without a recorded fee when support agrees (fee fields
 * stay unset / refund policy reflects no host fee). Ticket buyers with funds-escrow entries can claim refunds on the dashboard.
 * After the raffle is marked cancelled, attempts the same automatic escrow → creator transfer as
 * POST /return-prize-to-creator (NFT and partner SPL prizes). Non-escrow prize types are skipped.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    if (!raffle.cancellation_requested_at && !raffle.cancellation_fee_paid_at) {
      return NextResponse.json(
        { error: 'No cancellation request pending for this raffle' },
        { status: 400 }
      )
    }

    if (raffle.status === 'cancelled' && raffle.cancelled_at) {
      return NextResponse.json(
        { error: 'Raffle is already cancelled' },
        { status: 400 }
      )
    }

    const now = new Date()
    const hostPaidFee = !!raffle.cancellation_fee_paid_at
    const feeApplies = raffleRequiresCancellationFee(raffle, now)

    const refundPolicy: 'full_refund' | 'no_refund' = hostPaidFee && feeApplies ? 'no_refund' : 'full_refund'
    const feeSol = getCancellationFeeSol()
    const cancellationFeeAmount = hostPaidFee && feeApplies ? feeSol : null
    const cancellationFeeCurrency = hostPaidFee && feeApplies ? 'SOL' : null

    await updateRaffle(id, {
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
      await markZeroPaymentEntriesRefundedForRaffle(id)
    } catch (e) {
      console.error('[accept-cancellation] zero-payment refund close:', e)
    }

    /** NFT or partner SPL prize in escrow — return to creator automatically (same as return-prize-to-creator). */
    let prizeReturnAttempted = false
    let prizeReturnOk: boolean | undefined
    let prizeReturnSignature: string | undefined
    let prizeReturnError: string | undefined

    const escrowReturnKind =
      raffle.prize_type === 'nft' || isPartnerSplPrizeRaffle(raffle)
    const depositVerified = !!raffle.prize_deposited_at
    const noWinnerTransfer = !(raffle.nft_transfer_transaction ?? '').trim()
    const notYetReturned = !raffle.prize_returned_at

    const shouldTryPrizeReturn =
      escrowReturnKind &&
      depositVerified &&
      noWinnerTransfer &&
      notYetReturned

    if (shouldTryPrizeReturn) {
      prizeReturnAttempted = true
      const returnResult = isPartnerSplPrizeRaffle(raffle)
        ? await transferPartnerSplPrizeToCreator(id, 'cancelled')
        : await transferNftPrizeToCreator(id, 'cancelled')
      prizeReturnOk = returnResult.ok
      prizeReturnSignature = returnResult.signature
      prizeReturnError = returnResult.error
      if (!returnResult.ok && returnResult.error) {
        console.warn(
          `[accept-cancellation] Prize auto-return failed for raffle ${id}: ${returnResult.error}`
        )
      }
    }

    const milestoneReturnAttempts = await returnReturnableMilestoneDepositsToCreator(id)
    const milestoneReturnsOk = milestoneReturnAttempts.filter((a) => a.ok).length
    const milestoneReturnsFailed = milestoneReturnAttempts.filter((a) => !a.ok)

    const baseMessage =
      hostPaidFee && feeApplies
        ? `Raffle cancelled. Ticket buyers can claim refunds from the dashboard (funds escrow). The creator paid the ${feeSol} SOL cancellation fee.`
        : feeApplies && !hostPaidFee
          ? `Raffle cancelled. Ticket buyers can claim refunds from the dashboard (funds escrow). No verified post-start cancellation fee on file — admin accepted without treasury fee recording.`
          : 'Raffle cancelled. Ticket buyers can claim refunds from the dashboard (funds escrow). No post-start cancellation fee applied (raffle had not started by scheduled start time).'

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

    return NextResponse.json({
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
      ...(milestoneReturnAttempts.length > 0
        ? {
            milestoneReturnAttempts,
            milestoneReturnsOk,
            milestoneReturnErrors: milestoneReturnsFailed.map((a) => ({
              milestoneId: a.milestoneId,
              error: a.error,
            })),
          }
        : {}),
    })
  } catch (err) {
    console.error('[POST /api/raffles/[id]/accept-cancellation]', err)
    return NextResponse.json(
      { error: 'Failed to accept cancellation' },
      { status: 500 }
    )
  }
}
