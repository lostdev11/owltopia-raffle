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
      const endMs = new Date(raffle.end_time).getTime()
      const ended = !Number.isNaN(endMs) && endMs <= Date.now()
      if (raffle.prize_type !== 'nft') {
        reason = 'Buyouts apply to NFT prizes only.'
      } else if (!raffle.nft_mint_address?.trim()) {
        reason = 'No NFT mint on this listing.'
      } else if (!raffle.winner_wallet?.trim()) {
        reason = 'Winner has not been selected yet — buyouts open after the draw.'
      } else if (!raffle.prize_deposited_at) {
        reason = 'Prize is not verified in escrow yet.'
      } else if (raffle.prize_returned_at) {
        reason = 'Prize was returned to the creator — buyout closed.'
      } else if (raffle.buyout_closed_at) {
        reason = 'A buyout offer was already accepted.'
      } else if (raffle.nft_transfer_transaction?.trim()) {
        reason = 'Winner already claimed the NFT — buyout closed.'
      } else if (!ended) {
        reason = 'Raffle has not ended yet — buyouts open after the end time once a winner is drawn.'
      } else if (
        raffle.status === 'cancelled' ||
        raffle.status === 'draft' ||
        raffle.status === 'failed_refund_available' ||
        raffle.status === 'pending_min_not_met'
      ) {
        reason =
          raffle.status === 'failed_refund_available' || raffle.status === 'pending_min_not_met'
            ? 'This raffle did not complete successfully — buyouts are not available.'
            : 'Buyout is not available for this raffle state.'
      } else {
        reason = 'Buyout is not available for this raffle.'
      }
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
