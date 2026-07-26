import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { getBuyoutOfferById, finalizeBuyoutRefund } from '@/lib/db/buyout-offers'
import { resolveBuyoutDepositSource } from '@/lib/buyout/deposit-source'
import { refundBuyoutOfferFromFundsEscrow } from '@/lib/raffles/funds-escrow'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/buyout-offers/[offerId]/cover-from-escrow
 * Full admin: pay a legacy fee-treasury buyout refund from FUNDS_ESCROW (platform covers).
 * Original bid stays in RAFFLE_RECIPIENT_WALLET; use when treasury signing is unavailable.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ offerId: string }> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`cover-buyout-from-escrow:${ip}:${session.wallet}`, 20, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429 })
    }

    const params = await context.params
    const offerId = typeof params.offerId === 'string' ? params.offerId.trim() : ''
    if (!offerId) {
      return NextResponse.json({ ok: false, error: 'Invalid offer id' }, { status: 400 })
    }

    const offer = await getBuyoutOfferById(offerId)
    if (!offer) {
      return NextResponse.json({ ok: false, error: 'Offer not found' }, { status: 404 })
    }

    if (offer.refunded_at) {
      return NextResponse.json({
        ok: true,
        alreadyRefunded: true,
        offerId: offer.id,
        refundTransactionSignature: offer.refund_tx_signature,
        coveredFromEscrow: true,
      })
    }

    if (offer.status !== 'expired' && offer.status !== 'superseded') {
      return NextResponse.json(
        { ok: false, error: 'Offer is not eligible for refund (must be expired or superseded)' },
        { status: 400 }
      )
    }

    if (!offer.deposit_tx_signature?.trim()) {
      return NextResponse.json({ ok: false, error: 'No deposit was recorded for this offer' }, { status: 400 })
    }

    const source = await resolveBuyoutDepositSource(offer)
    if (source === 'funds_escrow') {
      return NextResponse.json(
        {
          ok: false,
          error:
            'This bid is already in funds escrow — use Send all from funds escrow or the bidder dashboard Claim refund.',
        },
        { status: 400 }
      )
    }
    if (source !== 'treasury') {
      return NextResponse.json(
        { ok: false, error: 'Could not verify where this buyout deposit was sent on-chain.' },
        { status: 400 }
      )
    }

    const payout = await refundBuyoutOfferFromFundsEscrow(offer)
    if (!payout.ok) {
      return NextResponse.json(
        { ok: false, error: 'error' in payout ? payout.error : 'Escrow cover refund failed' },
        { status: 503 }
      )
    }
    if (!payout.signature) {
      return NextResponse.json({ ok: false, error: 'Escrow cover refund failed' }, { status: 503 })
    }

    const saved = await finalizeBuyoutRefund({
      offerId: offer.id,
      refundTxSignature: payout.signature,
    })
    if (!saved) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Refund tx sent but could not update database. Record the tx manually.',
          refundTransactionSignature: payout.signature,
          coveredFromEscrow: true,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      offerId: offer.id,
      refundTransactionSignature: payout.signature,
      bidderWallet: offer.bidder_wallet,
      amount: offer.amount,
      currency: offer.currency,
      coveredFromEscrow: true,
    })
  } catch (error) {
    console.error('[admin/buyout-offers/cover-from-escrow]', error)
    return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 })
  }
}
