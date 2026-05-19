import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { getCancellationFeeSol } from '@/lib/config/raffles'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'
import { raffleRequiresCancellationFee } from '@/lib/raffles/cancellation-fee-policy'
import { recordCancellationFeePayment } from '@/lib/raffles/record-cancellation-payment'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/request-cancellation
 * Creator requests cancellation. If the raffle has already started (start_time in the past), the creator
 * must include a verified on-chain SOL transfer of the cancellation fee to treasury. Admin then accepts
 * in Owl Vision. Ticket buyers with funds-escrow sales can claim refunds from the dashboard.
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
    const rawSig =
      typeof (body as { feeTransactionSignature?: unknown }).feeTransactionSignature === 'string'
        ? (body as { feeTransactionSignature: string }).feeTransactionSignature.trim()
        : ''
    const feeTransactionSignature = rawSig.length > 0 ? rawSig : null

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
    const wallet = session.wallet.trim()
    if (!walletsEqualSolana(creatorWallet, wallet)) {
      return NextResponse.json(
        { error: 'Only the raffle creator can request cancellation' },
        { status: 403 }
      )
    }

    const status = (raffle.status ?? '').toLowerCase()
    if (status !== 'live' && status !== 'ready_to_draw') {
      return NextResponse.json(
        { error: 'Only live or ready-to-draw raffles can be cancelled' },
        { status: 400 }
      )
    }

    const needsFee = raffleRequiresCancellationFee(raffle, new Date())
    const treasury = getRaffleTreasuryWalletAddress()
    const feeSol = getCancellationFeeSol()

    const alreadyRequested = !!raffle.cancellation_requested_at
    const feePaid = !!raffle.cancellation_fee_paid_at

    if (alreadyRequested && feePaid) {
      return NextResponse.json({
        success: true,
        alreadyRequested: true,
        message: 'Cancellation already requested. Waiting for admin approval in Owl Vision.',
      })
    }

    if (alreadyRequested && needsFee && !feePaid) {
      if (!feeTransactionSignature) {
        return NextResponse.json(
          {
            error: `Pay the ${feeSol} SOL cancellation fee to the platform treasury from this wallet, then try again.`,
            requiresCancellationFee: true,
            feeSol,
            treasury,
          },
          { status: 400 }
        )
      }
      const recorded = await recordCancellationFeePayment({
        raffleId: id,
        raffle,
        creatorWallet: wallet,
        feeTransactionSignature,
        openCancellationRequest: false,
      })
      if (!recorded.ok) {
        return NextResponse.json(
          {
            error: recorded.error,
            requiresCancellationFee: recorded.requiresCancellationFee,
            feeSol: recorded.feeSol,
            treasury: recorded.treasury,
          },
          { status: recorded.status }
        )
      }
      return NextResponse.json({
        success: true,
        message: 'Cancellation fee recorded. An admin can now complete cancellation in Owl Vision.',
        feeRecorded: true,
        alreadyRecorded: recorded.alreadyRecorded,
      })
    }

    if (alreadyRequested) {
      return NextResponse.json({
        success: true,
        alreadyRequested: true,
        message: 'Cancellation already requested. Waiting for admin approval in Owl Vision.',
      })
    }

    if (needsFee) {
      if (!treasury) {
        return NextResponse.json(
          {
            error: 'Treasury wallet is not configured. Set RAFFLE_RECIPIENT_WALLET.',
          },
          { status: 500 }
        )
      }
      if (!feeTransactionSignature) {
        return NextResponse.json(
          {
            error: `This raffle has already started. Pay ${feeSol} SOL to the platform treasury to request cancellation.`,
            requiresCancellationFee: true,
            feeSol,
            treasury,
          },
          { status: 400 }
        )
      }
      const recorded = await recordCancellationFeePayment({
        raffleId: id,
        raffle,
        creatorWallet: wallet,
        feeTransactionSignature,
        openCancellationRequest: true,
      })
      if (!recorded.ok) {
        return NextResponse.json(
          {
            error: recorded.error,
            requiresCancellationFee: recorded.requiresCancellationFee,
            feeSol: recorded.feeSol,
            treasury: recorded.treasury,
          },
          { status: recorded.status }
        )
      }
      return NextResponse.json({
        success: true,
        message: 'Cancellation requested. An admin will review in Owl Vision.',
        alreadyRecorded: recorded.alreadyRecorded,
      })
    }

    const now = new Date().toISOString()
    await updateRaffle(id, {
      cancellation_requested_at: now,
    })

    return NextResponse.json({
      success: true,
      message: 'Cancellation requested. An admin will review in Owl Vision.',
    })
  } catch (err) {
    console.error('[POST /api/raffles/[id]/request-cancellation]', err)
    return NextResponse.json(
      { error: 'Failed to request cancellation' },
      { status: 500 }
    )
  }
}
