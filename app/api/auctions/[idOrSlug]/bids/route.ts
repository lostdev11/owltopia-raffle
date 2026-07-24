import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { canAccessPartnerAuctions } from '@/lib/auctions/access'
import { minNextBidAmount } from '@/lib/auctions/economics'
import { getAuctionByIdOrSlug, insertPendingAuctionBid } from '@/lib/db/auctions'
import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'
import { normalizeSolanaWalletAddress, walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ idOrSlug: string }> }

/** POST /api/auctions/[idOrSlug]/bids — create pending bid; client deposits to funds escrow then confirms. */
export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session
  if (!(await canAccessPartnerAuctions(session.wallet))) {
    return NextResponse.json({ error: 'Partner or admin access required' }, { status: 403 })
  }

  const wallet = normalizeSolanaWalletAddress(session.wallet)
  if (!wallet) {
    return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
  }

  const { idOrSlug } = await ctx.params
  const auction = await getAuctionByIdOrSlug(idOrSlug)
  if (!auction) {
    return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
  }
  if (auction.status !== 'live') {
    return NextResponse.json({ error: 'Auction is not live' }, { status: 400 })
  }
  if (new Date(auction.ends_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Auction has ended' }, { status: 400 })
  }
  if (walletsEqualSolana(wallet, auction.creator_wallet)) {
    return NextResponse.json({ error: 'Creators cannot bid on their own auction' }, { status: 403 })
  }

  let body: { amount?: number }
  try {
    body = (await request.json()) as { amount?: number }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const amount = Number(body.amount)
  const minNext = minNextBidAmount(auction)
  if (!Number.isFinite(amount) || amount < minNext) {
    return NextResponse.json(
      { error: `Bid must be at least ${minNext} ${auction.bid_currency}`, min_next_bid: minNext },
      { status: 400 }
    )
  }

  const depositWallet = getFundsEscrowPublicKey() || auction.funds_escrow_address_snapshot
  if (!depositWallet) {
    return NextResponse.json({ error: 'Funds escrow is not configured' }, { status: 503 })
  }

  const bid = await insertPendingAuctionBid({
    auctionId: auction.id,
    bidderWallet: wallet,
    currency: auction.bid_currency,
    amount,
  })
  if (!bid) {
    return NextResponse.json({ error: 'Failed to create bid' }, { status: 500 })
  }

  return NextResponse.json({
    bid: {
      id: bid.id,
      amount: bid.amount,
      currency: bid.currency,
      status: bid.status,
    },
    deposit_wallet: depositWallet,
    min_next_bid: minNext,
  })
}
