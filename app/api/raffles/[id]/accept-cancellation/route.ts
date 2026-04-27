import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { getCancellationFeeSol } from '@/lib/config/raffles'
import {
  canCompleteCancellationForAdmin,
  raffleRequiresCancellationFee,
} from '@/lib/raffles/cancellation-fee-policy'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/accept-cancellation
 * Full admin accepts a cancellation request. If the raffle had already started, the creator must have paid
 * the on-chain cancellation fee first. Ticket buyers with funds-escrow entries can claim refunds on the dashboard.
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

    if (!raffle.cancellation_requested_at) {
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

    if (!canCompleteCancellationForAdmin(raffle)) {
      return NextResponse.json(
        {
          error:
            'The creator has not paid the post-start cancellation fee on-chain. They must complete the 0.1 SOL transfer (or the amount set in CANCELLATION_FEE_SOL) to treasury before you can accept.',
        },
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
      cancellation_refund_policy: refundPolicy,
      cancellation_fee_amount: cancellationFeeAmount,
      cancellation_fee_currency: cancellationFeeCurrency,
      is_active: false,
    })

    return NextResponse.json({
      success: true,
      refundPolicy,
      cancellationFeeAmount,
      cancellationFeeCurrency,
      message:
        hostPaidFee && feeApplies
          ? `Raffle cancelled. Ticket buyers can claim refunds from the dashboard (funds escrow). The creator paid the ${feeSol} SOL cancellation fee.`
          : 'Raffle cancelled. Ticket buyers can claim refunds from the dashboard (funds escrow). No post-start cancellation fee applied.',
    })
  } catch (err) {
    console.error('[POST /api/raffles/[id]/accept-cancellation]', err)
    return NextResponse.json(
      { error: 'Failed to accept cancellation' },
      { status: 500 }
    )
  }
}
