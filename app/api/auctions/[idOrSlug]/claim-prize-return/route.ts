import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { canAccessPartnerAuctions } from '@/lib/auctions/access'
import { transferAuctionPrizeToRecipient } from '@/lib/auctions/prize'
import { toPublicAuction } from '@/lib/auctions/public'
import { getAuctionByIdOrSlug, markAuctionPrizeClaimed } from '@/lib/db/auctions'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ idOrSlug: string }> }

/** POST — creator reclaims prize when reserve not met / no bids. */
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
  if (auction.status !== 'failed_reserve') {
    return NextResponse.json(
      { error: 'Prize return is only available when the auction failed reserve / had no clearing bid' },
      { status: 400 }
    )
  }
  if (!walletsEqualSolana(session.wallet, auction.creator_wallet)) {
    return NextResponse.json({ error: 'Only the creator can reclaim the prize' }, { status: 403 })
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
    recipientWallet: auction.creator_wallet,
  })
  if (!transfer.ok) {
    return NextResponse.json({ error: transfer.error }, { status: 500 })
  }

  const updated = await markAuctionPrizeClaimed({
    auctionId: auction.id,
    claimTx: transfer.signature,
  })
  return NextResponse.json({
    ok: true,
    signature: transfer.signature,
    auction: updated ? toPublicAuction(updated) : null,
  })
}
