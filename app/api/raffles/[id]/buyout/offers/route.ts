import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import { insertPendingBuyoutOffer } from '@/lib/db/buyout-offers'
import { isRaffleBuyoutWindowOpen } from '@/lib/buyout/eligibility'
import { requireSession } from '@/lib/auth-server'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'

export const dynamic = 'force-dynamic'

const MIN_SOL = 0.01
const MIN_USDC = 1

/**
 * POST /api/raffles/[id]/buyout/offers
 * Authenticated bidder starts an offer (deposit tx confirmed separately).
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
    if (typeof raffleId !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const amount = typeof body.amount === 'number' ? body.amount : parseFloat(String(body.amount ?? ''))
    const currency = String(body.currency ?? 'SOL').toUpperCase()

    if (currency !== 'SOL' && currency !== 'USDC') {
      return NextResponse.json({ error: 'Currency must be SOL or USDC' }, { status: 400 })
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }
    if (currency === 'SOL' && amount < MIN_SOL) {
      return NextResponse.json({ error: `Minimum offer is ${MIN_SOL} SOL` }, { status: 400 })
    }
    if (currency === 'USDC' && amount < MIN_USDC) {
      return NextResponse.json({ error: `Minimum offer is ${MIN_USDC} USDC` }, { status: 400 })
    }

    const raffle = await getRaffleById(raffleId.trim())
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    if (!isRaffleBuyoutWindowOpen(raffle)) {
      return NextResponse.json(
        { error: 'Buyout bidding is not open for this raffle.' },
        { status: 400 },
      )
    }

    const treasuryWallet = getRaffleTreasuryWalletAddress()
    if (!treasuryWallet) {
      return NextResponse.json(
        { error: 'Treasury wallet is not configured (RAFFLE_RECIPIENT_WALLET).' },
        { status: 503 },
      )
    }

    const bidderWallet = session.wallet.trim()

    const offer = await insertPendingBuyoutOffer({
      raffleId: raffle.id,
      bidderWallet,
      currency: currency as 'SOL' | 'USDC',
      amount,
    })

    if (!offer) {
      return NextResponse.json({ error: 'Could not create offer' }, { status: 500 })
    }

    return NextResponse.json({
      offerId: offer.id,
      treasuryWallet,
      amount,
      currency,
    })
  } catch (e) {
    console.error('POST buyout offer:', e)
    return NextResponse.json({ error: 'Failed to create offer' }, { status: 500 })
  }
}
