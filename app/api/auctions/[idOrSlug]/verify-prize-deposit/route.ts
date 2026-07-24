import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { canCreatePartnerAuction } from '@/lib/auctions/access'
import { toPublicAuction } from '@/lib/auctions/public'
import { verifyAuctionPrizeDeposit } from '@/lib/auctions/prize'
import { getAuctionByIdOrSlug, markAuctionPrizeDeposited } from '@/lib/db/auctions'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ idOrSlug: string }> }

/** POST /api/auctions/[idOrSlug]/verify-prize-deposit — goes live when prize is in escrow. */
export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session
  if (!(await canCreatePartnerAuction(session.wallet))) {
    return NextResponse.json({ error: 'Partner or admin access required' }, { status: 403 })
  }

  const { idOrSlug } = await ctx.params
  const auction = await getAuctionByIdOrSlug(idOrSlug)
  if (!auction) {
    return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
  }
  if (!walletsEqualSolana(session.wallet, auction.creator_wallet)) {
    return NextResponse.json({ error: 'Only the creator can verify the prize deposit' }, { status: 403 })
  }
  if (auction.status === 'live' && auction.prize_deposited_at) {
    return NextResponse.json({
      ok: true,
      alreadyVerified: true,
      auction: toPublicAuction(auction),
    })
  }
  if (auction.status !== 'draft') {
    return NextResponse.json({ error: `Cannot verify deposit in status ${auction.status}` }, { status: 400 })
  }

  let depositTx: string | null = null
  try {
    const body = (await request.json()) as { deposit_tx?: string }
    depositTx = typeof body.deposit_tx === 'string' ? body.deposit_tx.trim() : null
  } catch {
    // optional body
  }

  const verified = await verifyAuctionPrizeDeposit({ auction, depositTx })
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: verified.httpStatus })
  }

  const updated = await markAuctionPrizeDeposited({
    auctionId: auction.id,
    depositTx,
  })
  if (!updated) {
    return NextResponse.json({ error: 'Failed to mark deposit / go live' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    auction: toPublicAuction(updated),
  })
}
