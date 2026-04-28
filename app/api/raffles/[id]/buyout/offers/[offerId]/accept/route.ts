import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import {
  expireStaleBuyoutOffersForRaffle,
  getBuyoutOfferById,
  finalizeBuyoutAcceptance,
} from '@/lib/db/buyout-offers'
import { isRaffleBuyoutWindowOpen } from '@/lib/buyout/eligibility'
import { requireSession } from '@/lib/auth-server'
import { payoutBuyoutAcceptance, computeBuyoutSettlement } from '@/lib/buyout/settlement'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/buyout/offers/[offerId]/accept
 * Winner accepts one buyout; pays winner net (after 1% fee) from treasury.
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

    const winnerWallet = raffle.winner_wallet?.trim()
    if (!winnerWallet || winnerWallet !== session.wallet.trim()) {
      return NextResponse.json({ error: 'Only the prize winner can accept a buyout offer' }, { status: 403 })
    }

    await expireStaleBuyoutOffersForRaffle(raffle.id)

    if (!isRaffleBuyoutWindowOpen(raffle)) {
      return NextResponse.json(
        { error: 'Buyout is no longer available for this raffle.' },
        { status: 400 },
      )
    }

    const offer = await getBuyoutOfferById(offerId.trim())
    if (!offer || offer.raffle_id !== raffle.id) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
    }
    if (offer.status !== 'active') {
      return NextResponse.json({ error: 'Offer is not active' }, { status: 400 })
    }

    const expMs = offer.expires_at ? new Date(offer.expires_at).getTime() : 0
    if (!expMs || expMs <= Date.now()) {
      return NextResponse.json({ error: 'This offer has expired' }, { status: 400 })
    }

    const { winnerNet, treasuryFee } = computeBuyoutSettlement(offer)

    const payout = await payoutBuyoutAcceptance({ offer, winnerWallet })
    if (!payout.ok) {
      return NextResponse.json({ error: payout.error }, { status: 503 })
    }

    const ok = await finalizeBuyoutAcceptance({
      offerId: offer.id,
      raffleId: raffle.id,
      winnerWallet,
      treasuryFeeAmount: treasuryFee,
      winnerNetAmount: winnerNet,
      payoutTxSignature: payout.signature,
    })

    if (!ok) {
      return NextResponse.json(
        {
          error:
            'Payout may have succeeded but database update failed. Contact support with your tx signature.',
          transactionSignature: payout.signature,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      transactionSignature: payout.signature,
      winnerNetAmount: winnerNet,
      treasuryFeeAmount: treasuryFee,
      /** Other bidders should open Dashboard to reclaim escrowed bids */
      redirectToDashboard: true,
    })
  } catch (e) {
    console.error('accept buyout:', e)
    return NextResponse.json({ error: 'Failed to accept offer' }, { status: 500 })
  }
}
