import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getRaffleById } from '@/lib/db/raffles'
import { getCancellationFeeSol } from '@/lib/config/raffles'
import { raffleRequiresCancellationFee } from '@/lib/raffles/cancellation-fee-policy'
import { recordCancellationFeePayment } from '@/lib/raffles/record-cancellation-payment'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/pay-cancellation-fee
 * If a raffle was cancelled (including legacy admin accepts) and the start time had already passed, the
 * creator may still need to pay the SOL fee to unlock "claim prize back" and align with policy.
 * For live / ready-to-draw raffles, a verified fee is also treated as a cancellation request so admins see it.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const raw =
      typeof (body as { feeTransactionSignature?: unknown }).feeTransactionSignature === 'string'
        ? (body as { feeTransactionSignature: string }).feeTransactionSignature.trim()
        : ''
    if (!raw) {
      return NextResponse.json({ error: 'feeTransactionSignature is required' }, { status: 400 })
    }

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const creator = (raffle.creator_wallet || raffle.created_by || '').trim()
    const wallet = session.wallet.trim()
    if (!walletsEqualSolana(creator, wallet)) {
      return NextResponse.json({ error: 'Only the raffle creator can pay this fee' }, { status: 403 })
    }

    if (!raffleRequiresCancellationFee(raffle, new Date())) {
      return NextResponse.json(
        { error: 'A cancellation fee is not required for this raffle (it had not started by schedule).' },
        { status: 400 }
      )
    }

    const status = (raffle.status ?? '').toLowerCase()
    const isOpenCancellationStatus = status === 'live' || status === 'ready_to_draw'

    if (raffle.cancellation_fee_paid_at && raffle.cancellation_requested_at) {
      return NextResponse.json({ success: true, alreadyPaid: true, cancellationRequested: true })
    }

    const recorded = await recordCancellationFeePayment({
      raffleId: id,
      raffle,
      creatorWallet: wallet,
      feeTransactionSignature: raw,
      openCancellationRequest: isOpenCancellationStatus,
    })

    if (!recorded.ok) {
      return NextResponse.json(
        {
          error: recorded.error,
          feeSol: recorded.feeSol ?? getCancellationFeeSol(),
          treasury: recorded.treasury,
        },
        { status: recorded.status }
      )
    }

    return NextResponse.json({
      success: true,
      alreadyPaid: recorded.alreadyRecorded,
      cancellationRequested: recorded.cancellationRequested,
    })
  } catch (e) {
    console.error('[pay-cancellation-fee]', e)
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
  }
}
