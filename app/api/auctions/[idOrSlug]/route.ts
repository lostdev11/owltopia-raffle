import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { canAccessPartnerAuctions } from '@/lib/auctions/access'
import { toPublicAuction } from '@/lib/auctions/public'
import { getAuctionByIdOrSlug, listBidsForAuction, cancelDraftAuction } from '@/lib/db/auctions'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ idOrSlug: string }> }

/** GET /api/auctions/[idOrSlug] */
export async function GET(request: NextRequest, ctx: Ctx) {
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

  const bids = await listBidsForAuction(auction.id)
  const publicBids = bids
    .filter((b) => b.status !== 'pending_deposit')
    .map((b) => ({
      id: b.id,
      bidder_wallet: b.bidder_wallet,
      amount: b.amount,
      currency: b.currency,
      status: b.status,
      activated_at: b.activated_at,
      created_at: b.created_at,
    }))

  return NextResponse.json({
    auction: toPublicAuction(auction),
    bids: publicBids,
    viewer_is_creator: walletsEqualSolana(session.wallet, auction.creator_wallet),
  })
}

/** DELETE /api/auctions/[idOrSlug] — cancel draft only. */
export async function DELETE(request: NextRequest, ctx: Ctx) {
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
  if (!walletsEqualSolana(session.wallet, auction.creator_wallet)) {
    return NextResponse.json({ error: 'Only the creator can cancel' }, { status: 403 })
  }
  if (auction.status !== 'draft') {
    return NextResponse.json(
      { error: 'Only draft auctions (no bids / not live) can be cancelled' },
      { status: 400 }
    )
  }

  const ok = await cancelDraftAuction(auction.id, auction.creator_wallet)
  if (!ok) {
    return NextResponse.json({ error: 'Cancel failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
