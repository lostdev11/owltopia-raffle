import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { canAccessPartnerAuctions } from '@/lib/auctions/access'
import { toPublicAuction } from '@/lib/auctions/public'
import {
  getAuctionByIdOrSlug,
  markAuctionCreatorProceedsClaimed,
  maybeCompleteAuction,
} from '@/lib/db/auctions'
import { payoutBuyoutAcceptanceFromFundsEscrow } from '@/lib/raffles/funds-escrow'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ idOrSlug: string }> }

/** POST — creator claims net winning bid (platform fee sent in same tx). */
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
  if (!walletsEqualSolana(session.wallet, auction.creator_wallet)) {
    return NextResponse.json({ error: 'Only the creator can claim proceeds' }, { status: 403 })
  }
  if (auction.creator_claimed_at && auction.creator_claim_tx) {
    return NextResponse.json({
      ok: true,
      alreadyClaimed: true,
      signature: auction.creator_claim_tx,
      auction: toPublicAuction(auction),
    })
  }

  const creatorNet = Number(auction.creator_payout_amount ?? 0)
  const fee = Number(auction.platform_fee_amount ?? 0)
  if (!Number.isFinite(creatorNet) || creatorNet <= 0) {
    return NextResponse.json({ error: 'Nothing to claim' }, { status: 400 })
  }

  const payout = await payoutBuyoutAcceptanceFromFundsEscrow({
    winnerWallet: auction.creator_wallet,
    winnerNet: creatorNet,
    treasuryFee: Math.max(0, fee),
    currency: auction.bid_currency,
  })
  if (!payout.ok) {
    return NextResponse.json({ error: payout.error || 'Payout failed' }, { status: 500 })
  }

  const updated = await markAuctionCreatorProceedsClaimed({
    auctionId: auction.id,
    claimTx: payout.signature,
  })
  await maybeCompleteAuction(auction.id)
  const fresh = updated || (await getAuctionByIdOrSlug(auction.id))
  return NextResponse.json({
    ok: true,
    signature: payout.signature,
    auction: fresh ? toPublicAuction(fresh) : null,
  })
}
