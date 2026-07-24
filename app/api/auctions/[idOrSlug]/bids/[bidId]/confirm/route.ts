import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { canAccessPartnerAuctions } from '@/lib/auctions/access'
import { toPublicAuction } from '@/lib/auctions/public'
import { computeSoftCloseUpdate } from '@/lib/auctions/soft-close'
import {
  activateAuctionBidAfterDeposit,
  finalizeBidRefund,
  getAuctionByIdOrSlug,
  getBidById,
} from '@/lib/db/auctions'
import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'
import { refundBuyoutOfferFromFundsEscrow } from '@/lib/raffles/funds-escrow'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'
import { verifyBuyoutDepositTx } from '@/lib/verify-buyout-deposit'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ idOrSlug: string; bidId: string }> }

/** POST — confirm on-chain bid deposit; activates bid and marks prior high bid outbid. */
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
  if (auction.status !== 'live') {
    return NextResponse.json({ error: 'Auction is not live' }, { status: 400 })
  }

  const bid = await getBidById(bidId)
  if (!bid || bid.auction_id !== auction.id) {
    return NextResponse.json({ error: 'Bid not found' }, { status: 404 })
  }
  if (!walletsEqualSolana(session.wallet, bid.bidder_wallet)) {
    return NextResponse.json({ error: 'Only the bidder can confirm this deposit' }, { status: 403 })
  }
  if (bid.status === 'active') {
    return NextResponse.json({ ok: true, alreadyActive: true, bid })
  }
  if (bid.status !== 'pending_deposit') {
    return NextResponse.json({ error: `Bid status is ${bid.status}` }, { status: 400 })
  }

  let depositTx: string
  try {
    const body = (await request.json()) as { deposit_tx?: string }
    depositTx = typeof body.deposit_tx === 'string' ? body.deposit_tx.trim() : ''
  } catch {
    return NextResponse.json({ error: 'deposit_tx required' }, { status: 400 })
  }
  if (!depositTx) {
    return NextResponse.json({ error: 'deposit_tx required' }, { status: 400 })
  }

  const depositWallet = getFundsEscrowPublicKey() || auction.funds_escrow_address_snapshot
  if (!depositWallet) {
    return NextResponse.json({ error: 'Funds escrow not configured' }, { status: 503 })
  }

  const verified = await verifyBuyoutDepositTx({
    transactionSignature: depositTx,
    bidderWallet: bid.bidder_wallet,
    depositWallet,
    expectedAmount: bid.amount,
    currency: bid.currency,
  })
  if (!verified.valid) {
    return NextResponse.json({ error: verified.error || 'Deposit verification failed' }, { status: 400 })
  }

  // Re-check end time after verify (soft race).
  const fresh = await getAuctionByIdOrSlug(auction.id)
  if (!fresh || fresh.status !== 'live') {
    return NextResponse.json({ error: 'Auction is no longer live' }, { status: 400 })
  }
  if (new Date(fresh.ends_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Auction has ended' }, { status: 400 })
  }

  const soft = computeSoftCloseUpdate(fresh)
  const activated = await activateAuctionBidAfterDeposit({
    bidId: bid.id,
    depositTxSignature: depositTx,
    auctionId: fresh.id,
    amount: bid.amount,
    previousBidId: fresh.current_bid_id,
    softCloseEndsAt: soft?.endsAt ?? null,
    softCloseExtensions: soft?.extensions ?? null,
  })
  if (!activated) {
    return NextResponse.json({ error: 'Failed to activate bid' }, { status: 500 })
  }

  // Best-effort auto-refund of previous high bidder.
  let previousRefund: { ok: boolean; error?: string; signature?: string } | null = null
  if (activated.previousBidId) {
    const prev = await getBidById(activated.previousBidId)
    if (prev && prev.status === 'outbid') {
      const refund = await refundBuyoutOfferFromFundsEscrow({
        bidder_wallet: prev.bidder_wallet,
        amount: prev.amount,
        currency: prev.currency,
      })
      if (refund.ok) {
        await finalizeBidRefund({ bidId: prev.id, refundTxSignature: refund.signature })
        previousRefund = { ok: true, signature: refund.signature }
      } else {
        previousRefund = {
          ok: false,
          error: refund.error || 'Auto-refund failed; bidder can claim refund',
        }
      }
    }
  }

  const updatedAuction = await getAuctionByIdOrSlug(auction.id)
  return NextResponse.json({
    ok: true,
    bid: activated.bid,
    auction: updatedAuction ? toPublicAuction(updatedAuction) : null,
    soft_close_applied: !!soft,
    previous_bid_refund: previousRefund,
  })
}
