import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import { adminRecordBuyoutRefundBody, parseOr400 } from '@/lib/validations'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { getBuyoutOfferById, recordBuyoutRefundManual } from '@/lib/db/buyout-offers'
import { resolveBuyoutDepositSource } from '@/lib/buyout/deposit-source'
import { verifyBuyoutRefundTx } from '@/lib/verify-buyout-refund'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/buyout-offers/[offerId]/record-refund
 * Full admin: after manually sending a legacy treasury buyout refund, verify tx and mark offer refunded.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ offerId: string }> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`record-buyout-refund:${ip}:${session.wallet}`, 40, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429 })
    }

    const params = await context.params
    const offerId = typeof params.offerId === 'string' ? params.offerId.trim() : ''
    if (!offerId) {
      return NextResponse.json({ ok: false, error: 'Invalid offer id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(adminRecordBuyoutRefundBody, body)
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
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
      })
    }

    if (offer.status !== 'expired' && offer.status !== 'superseded') {
      return NextResponse.json(
        { ok: false, error: 'Offer is not eligible for refund (must be expired or superseded)' },
        { status: 400 }
      )
    }

    const source = await resolveBuyoutDepositSource(offer)
    if (source === 'funds_escrow') {
      return NextResponse.json(
        {
          ok: false,
          error:
            'This bid is in funds escrow — the bidder should use Claim refund on the dashboard (or use admin escrow tools).',
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

    const refundTxSignature = parsed.data.refundTransactionSignature.trim()
    const verify = await verifyBuyoutRefundTx({
      transactionSignature: refundTxSignature,
      bidderWallet: offer.bidder_wallet,
      expectedAmount: offer.amount,
      currency: offer.currency,
    })
    if (!verify.valid) {
      return NextResponse.json(
        { ok: false, error: verify.error ?? 'Refund transaction verification failed' },
        { status: 400 }
      )
    }

    const result = await recordBuyoutRefundManual({ offerId, refundTxSignature })
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      offerId: offer.id,
      refundTransactionSignature: refundTxSignature,
      bidderWallet: offer.bidder_wallet,
      amount: offer.amount,
      currency: offer.currency,
    })
  } catch (error) {
    console.error('[admin/buyout-offers/record-refund]', error)
    return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 })
  }
}
