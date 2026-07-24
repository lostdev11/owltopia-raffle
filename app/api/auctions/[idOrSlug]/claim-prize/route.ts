import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { canAccessPartnerAuctions } from '@/lib/auctions/access'
import { transferAuctionPrizeToRecipient } from '@/lib/auctions/prize'
import { toPublicAuction } from '@/lib/auctions/public'
import {
  getAuctionByIdOrSlug,
  markAuctionPrizeClaimed,
  maybeCompleteAuction,
} from '@/lib/db/auctions'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ idOrSlug: string }> }

/** POST — winner claims prize after successful auction. */
export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session
  if (!(await canAccessPartnerAuctions(session.wallet))) {
    return NextResponse.json({ error: 'Partner or admin access required' }, { status: 403 })
  }

  const { idOrSlug } = await ctx.params
  const auction = await getAuctionByIdOrSlug(idOrSlug)
  if (!auction) {
    return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
  }
  if (auction.status !== 'successful_pending_claims' && auction.status !== 'completed') {
    return NextResponse.json({ error: 'Auction is not in a claimable success state' }, { status: 400 })
  }
  if (!auction.winner_wallet || !walletsEqualSolana(session.wallet, auction.winner_wallet)) {
    return NextResponse.json({ error: 'Only the winning bidder can claim the prize' }, { status: 403 })
  }
  if (auction.prize_claimed_at && auction.prize_claim_tx) {
    return NextResponse.json({
      ok: true,
      alreadyClaimed: true,
      signature: auction.prize_claim_tx,
      auction: toPublicAuction(auction),
    })
  }

  const transfer = await transferAuctionPrizeToRecipient({
    auction,
    recipientWallet: auction.winner_wallet,
  })
  if (!transfer.ok) {
    return NextResponse.json({ error: transfer.error }, { status: 500 })
  }

  const updated = await markAuctionPrizeClaimed({
    auctionId: auction.id,
    claimTx: transfer.signature,
  })
  await maybeCompleteAuction(auction.id)
  const fresh = updated || (await getAuctionByIdOrSlug(auction.id))
  return NextResponse.json({
    ok: true,
    signature: transfer.signature,
    auction: fresh ? toPublicAuction(fresh) : null,
  })
}
