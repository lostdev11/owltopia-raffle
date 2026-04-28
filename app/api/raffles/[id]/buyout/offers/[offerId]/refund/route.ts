import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import {
  expireStaleBuyoutOffersForRaffle,
  finalizeBuyoutRefund,
  getRefundEligibleOffer,
} from '@/lib/db/buyout-offers'
import { requireSession } from '@/lib/auth-server'
import { refundBuyoutToBidder } from '@/lib/buyout/settlement'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/buyout/offers/[offerId]/refund
 * Bidder reclaims escrow after offer expired or was superseded (requires treasury signing).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const raffleId = params.id
    const offerId = params.offerId
    if (typeof raffleId !== 'string' || typeof offerId !== 'string') {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
    }

    const raffle = await getRaffleById(raffleId.trim())
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    await expireStaleBuyoutOffersForRaffle(raffle.id)

    const offer = await getRefundEligibleOffer(offerId.trim())
    if (!offer || offer.raffle_id !== raffle.id) {
      return NextResponse.json({ error: 'Nothing to refund for this offer' }, { status: 400 })
    }
    if (offer.bidder_wallet.trim() !== session.wallet.trim()) {
      return NextResponse.json({ error: 'Not your offer' }, { status: 403 })
    }
    if (!offer.deposit_tx_signature) {
      return NextResponse.json({ error: 'No deposit was recorded for this offer' }, { status: 400 })
    }

    const payout = await refundBuyoutToBidder(offer)
    if (!payout.ok) {
      return NextResponse.json({ error: payout.error }, { status: 503 })
    }

    const saved = await finalizeBuyoutRefund({
      offerId: offer.id,
      refundTxSignature: payout.signature,
    })

    if (!saved) {
      return NextResponse.json(
        {
          error: 'Refund tx sent but could not update database. Contact support.',
          transactionSignature: payout.signature,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      transactionSignature: payout.signature,
    })
  } catch (e) {
    console.error('buyout refund:', e)
    return NextResponse.json({ error: 'Failed to process refund' }, { status: 500 })
  }
}
