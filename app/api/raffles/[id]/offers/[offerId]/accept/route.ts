import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getRaffleById } from '@/lib/db/raffles'
import {
  acceptRaffleOffer,
  expirePendingOffers,
  isRaffleOfferWindowOpen,
} from '@/lib/db/raffle-offers'
import {
  checkEscrowHoldsNft,
  checkEscrowHoldsPartnerSplPrize,
} from '@/lib/raffles/prize-escrow'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'

export const dynamic = 'force-dynamic'

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
      return NextResponse.json({ error: 'Invalid path params' }, { status: 400 })
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })

    const winnerWallet = (raffle.winner_wallet ?? '').trim()
    if (!winnerWallet) {
      return NextResponse.json({ error: 'Winner has not been selected yet' }, { status: 400 })
    }
    if (winnerWallet !== session.wallet.trim()) {
      return NextResponse.json({ error: 'Only raffle winner can accept offers' }, { status: 403 })
    }

    const now = new Date()
    if (!isRaffleOfferWindowOpen(raffle, now)) {
      return NextResponse.json({ error: 'Offer window is closed' }, { status: 400 })
    }

    // Offers can only be accepted while the prize is still held in escrow.
    // This prevents "accept" after creator-return or after winner claim/manual release.
    if (raffle.prize_returned_at || raffle.nft_transfer_transaction) {
      return NextResponse.json(
        { error: 'Offer cannot be accepted because the prize is no longer in escrow' },
        { status: 400 }
      )
    }

    const partnerSpl = isPartnerSplPrizeRaffle(raffle)
    const escrowState = partnerSpl
      ? await checkEscrowHoldsPartnerSplPrize(raffle)
      : await checkEscrowHoldsNft(raffle)

    if (!escrowState.holds) {
      return NextResponse.json(
        {
          error: `Offer cannot be accepted because escrow no longer holds the prize${escrowState.error ? ` (${escrowState.error})` : ''}`,
        },
        { status: 400 }
      )
    }

    await expirePendingOffers(raffleId, now)
    const offer = await acceptRaffleOffer({
      raffleId,
      offerId,
      winnerWallet,
      now,
    })

    return NextResponse.json({ offer }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to accept offer'
    const status =
      message.includes('not found')
        ? 404
        : message.includes('no longer pending') || message.includes('expired')
          ? 400
          : 500
    if (status === 500) {
      console.error('[POST /api/raffles/[id]/offers/[offerId]/accept]', error)
    }
    return NextResponse.json({ error: message }, { status })
  }
}
