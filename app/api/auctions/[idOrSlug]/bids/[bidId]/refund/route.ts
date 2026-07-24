import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { canAccessPartnerAuctions } from '@/lib/auctions/access'
import { finalizeBidRefund, getAuctionByIdOrSlug, getBidById } from '@/lib/db/auctions'
import { refundBuyoutOfferFromFundsEscrow } from '@/lib/raffles/funds-escrow'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ idOrSlug: string; bidId: string }> }

/** POST — claim refund for outbid / expired (reserve fail) bids. */
export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session
  if (!(await canAccessPartnerAuctions(session.wallet))) {
    return NextResponse.json({ error: 'Partner or admin access required' }, { status: 403 })
  }

  const { idOrSlug, bidId } = await ctx.params
  const auction = await getAuctionByIdOrSlug(idOrSlug)
  if (!auction) {
    return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
  }

  const bid = await getBidById(bidId)
  if (!bid || bid.auction_id !== auction.id) {
    return NextResponse.json({ error: 'Bid not found' }, { status: 404 })
  }
  if (!walletsEqualSolana(session.wallet, bid.bidder_wallet)) {
    return NextResponse.json({ error: 'Only the bidder can claim this refund' }, { status: 403 })
  }
  if (bid.status === 'refunded') {
    return NextResponse.json({ ok: true, alreadyRefunded: true, bid })
  }
  if (bid.status !== 'outbid' && bid.status !== 'expired') {
    return NextResponse.json(
      { error: `Bid is ${bid.status}; only outbid or expired (reserve fail) bids are refundable` },
      { status: 400 }
    )
  }

  const refund = await refundBuyoutOfferFromFundsEscrow({
    bidder_wallet: bid.bidder_wallet,
    amount: bid.amount,
    currency: bid.currency,
  })
  if (!refund.ok) {
    return NextResponse.json({ error: refund.error || 'Refund failed' }, { status: 500 })
  }

  const updated = await finalizeBidRefund({
    bidId: bid.id,
    refundTxSignature: refund.signature,
  })
  return NextResponse.json({ ok: true, bid: updated, signature: refund.signature })
}
