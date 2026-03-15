import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { FULL_REFUND_WINDOW_HOURS, getCancellationFeeSol } from '@/lib/config/raffles'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/accept-cancellation
 * Full admin accepts a cancellation request. Ticket buyers get refunds in all cases (treasury sends). Within 24h: no fee to host. After 24h: host is charged cancellation fee.
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

    const now = new Date()
    const created = new Date(raffle.created_at)
    const hoursSinceCreation = (now.getTime() - created.getTime()) / (60 * 60 * 1000)
    const fullRefundEligible = hoursSinceCreation <= FULL_REFUND_WINDOW_HOURS

    const refundPolicy: 'full_refund' | 'no_refund' = fullRefundEligible ? 'full_refund' : 'no_refund'
    const cancellationFeeAmount = fullRefundEligible ? null : getCancellationFeeSol()
    const cancellationFeeCurrency = fullRefundEligible ? null : 'SOL'

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
      message: fullRefundEligible
        ? 'Raffle cancelled. Ticket buyers get refunds (treasury sends). No fee to host.'
        : `Raffle cancelled. Ticket buyers get refunds (treasury sends). Host charged cancellation fee: ${cancellationFeeAmount} ${cancellationFeeCurrency}.`,
    })
  } catch (err) {
    console.error('[POST /api/raffles/[id]/accept-cancellation]', err)
    return NextResponse.json(
      { error: 'Failed to accept cancellation' },
      { status: 500 }
    )
  }
}
