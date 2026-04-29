import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getRaffleById } from '@/lib/db/raffles'
import {
  createOrReplacePendingOffer,
  expirePendingOffers,
  getRaffleOfferWindowEndsAt,
  isRaffleOfferWindowOpen,
  listRaffleOffers,
} from '@/lib/db/raffle-offers'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const params = await context.params
    const raffleId = params.id
    if (typeof raffleId !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })

    const now = new Date()
    await expirePendingOffers(raffleId, now)
    const offers = await listRaffleOffers(raffleId)
    const windowEndsAt = getRaffleOfferWindowEndsAt(raffle)

    return NextResponse.json({
      offers,
      offerWindowEndsAt: windowEndsAt?.toISOString() ?? null,
      offerWindowOpen: isRaffleOfferWindowOpen(raffle, now),
      currency: raffle.currency,
    })
  } catch (error) {
    console.error('[GET /api/raffles/[id]/offers]', error)
    return NextResponse.json({ error: 'Failed to load offers' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const raffleId = params.id
    if (typeof raffleId !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    const winnerWallet = (raffle.winner_wallet ?? '').trim()
    if (!winnerWallet) {
      return NextResponse.json({ error: 'Winner has not been selected yet' }, { status: 400 })
    }

    const buyerWallet = session.wallet.trim()
    if (buyerWallet === winnerWallet) {
      return NextResponse.json({ error: 'Winner cannot submit offers' }, { status: 400 })
    }

    const now = new Date()
    if (!isRaffleOfferWindowOpen(raffle, now)) {
      return NextResponse.json({ error: 'Offer window is closed' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const rawAmount = Number((body as { amount?: unknown }).amount ?? 0)
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
    }

    const roundedAmount = Math.round(rawAmount * 1_000_000) / 1_000_000
    if (roundedAmount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
    }

    await expirePendingOffers(raffleId, now)
    const windowEndsAt = getRaffleOfferWindowEndsAt(raffle)
    if (!windowEndsAt) {
      return NextResponse.json({ error: 'Offer window is unavailable' }, { status: 400 })
    }

    const offer = await createOrReplacePendingOffer({
      raffleId,
      buyerWallet,
      amount: roundedAmount,
      currency: raffle.currency,
      expiresAt: windowEndsAt,
    })

    return NextResponse.json({ offer }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/raffles/[id]/offers]', error)
    return NextResponse.json({ error: 'Failed to submit offer' }, { status: 500 })
  }
}
