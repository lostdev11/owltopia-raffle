import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import {
  activateBuyoutOfferAfterDeposit,
  expireStaleBuyoutOffersForRaffle,
  getBuyoutOfferById,
} from '@/lib/db/buyout-offers'
import { isRaffleBuyoutWindowOpen } from '@/lib/buyout/eligibility'
import { requireSession } from '@/lib/auth-server'
import { verifyBuyoutDepositTx } from '@/lib/verify-buyout-deposit'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/buyout/offers/[offerId]/confirm
 * Confirms treasury deposit for a pending offer.
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

    const body = await request.json().catch(() => ({}))
    const transactionSignature =
      typeof body.transactionSignature === 'string' ? body.transactionSignature.trim() : ''
    if (!transactionSignature) {
      return NextResponse.json({ error: 'transactionSignature is required' }, { status: 400 })
    }

    const raffle = await getRaffleById(raffleId.trim())
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    await expireStaleBuyoutOffersForRaffle(raffle.id)

    if (!isRaffleBuyoutWindowOpen(raffle)) {
      return NextResponse.json(
        { error: 'Buyout bidding is not open for this raffle.' },
        { status: 400 },
      )
    }

    const offer = await getBuyoutOfferById(offerId.trim())
    if (!offer || offer.raffle_id !== raffle.id) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
    }
    if (offer.bidder_wallet.trim() !== session.wallet.trim()) {
      return NextResponse.json({ error: 'Not your offer' }, { status: 403 })
    }
    if (offer.status !== 'pending_deposit') {
      return NextResponse.json(
        { error: 'Offer is not awaiting deposit confirmation' },
        { status: 400 },
      )
    }

    const treasuryWallet = getRaffleTreasuryWalletAddress()
    if (!treasuryWallet) {
      return NextResponse.json({ error: 'Treasury not configured' }, { status: 503 })
    }

    const verify = await verifyBuyoutDepositTx({
      transactionSignature,
      bidderWallet: offer.bidder_wallet,
      treasuryWallet,
      expectedAmount: offer.amount,
      currency: offer.currency,
    })

    if (!verify.valid) {
      return NextResponse.json({ error: verify.error ?? 'Verification failed' }, { status: 400 })
    }

    const activated = await activateBuyoutOfferAfterDeposit({
      offerId: offer.id,
      depositTxSignature: transactionSignature,
    })

    if (!activated) {
      return NextResponse.json(
        { error: 'Could not activate offer (wrong state or duplicate tx)' },
        { status: 409 },
      )
    }

    return NextResponse.json({
      success: true,
      offer: activated,
    })
  } catch (e) {
    console.error('confirm buyout:', e)
    return NextResponse.json({ error: 'Failed to confirm offer' }, { status: 500 })
  }
}
