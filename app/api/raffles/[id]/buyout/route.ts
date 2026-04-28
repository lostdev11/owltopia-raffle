import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import { expireStaleBuyoutOffersForRaffle, listBuyoutOffersForRaffle } from '@/lib/db/buyout-offers'
import { isRaffleBuyoutWindowOpen } from '@/lib/buyout/eligibility'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'

export const dynamic = 'force-dynamic'

function truncateWallet(w: string): string {
  const s = w.trim()
  if (s.length <= 12) return s
  return `${s.slice(0, 4)}…${s.slice(-4)}`
}

/**
 * GET /api/raffles/[id]/buyout
 * Public: eligibility + sanitized active/historical offers for UI.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const raffle = await getRaffleById(id.trim())
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    await expireStaleBuyoutOffersForRaffle(raffle.id)

    const eligible = isRaffleBuyoutWindowOpen(raffle)
    let reason: string | null = null
    if (!eligible) {
      if (raffle.prize_type !== 'nft') reason = 'Buyouts apply to NFT prizes only.'
      else if (!raffle.winner_wallet?.trim()) reason = 'Winner has not been selected yet.'
      else if (raffle.nft_transfer_transaction?.trim()) reason = 'Prize already transferred — buyout closed.'
      else if (raffle.buyout_closed_at) reason = 'A buyout offer was already accepted.'
      else if (new Date(raffle.end_time).getTime() > Date.now()) reason = 'Raffle has not ended yet.'
      else reason = 'Buyout is not available for this raffle.'
    }

    const rawOffers = await listBuyoutOffersForRaffle(raffle.id)
    const offers = rawOffers.map((o) => ({
      id: o.id,
      bidderDisplay: truncateWallet(o.bidder_wallet),
      currency: o.currency,
      amount: o.amount,
      status: o.status,
      createdAt: o.created_at,
      expiresAt: o.expires_at,
      activatedAt: o.activated_at,
    }))

    const treasuryWallet = getRaffleTreasuryWalletAddress()

    return NextResponse.json({
      eligible,
      reason,
      treasuryWallet,
      buyoutFeeBps: 100,
      winnerWallet: raffle.winner_wallet?.trim() ?? null,
      buyoutClosedAt: raffle.buyout_closed_at ?? null,
      offers,
    })
  } catch (e) {
    console.error('GET buyout:', e)
    return NextResponse.json({ error: 'Failed to load buyout data' }, { status: 500 })
  }
}
