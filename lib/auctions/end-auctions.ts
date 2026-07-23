import {
  getAuctionById,
  listAuctionsPastEndNeedingClose,
  markAuctionFailedReserve,
  markAuctionSuccessfulPendingClaims,
} from '@/lib/db/auctions'
import { computeAuctionSettlement, isReserveMet } from '@/lib/auctions/economics'

export type EndAuctionResult = {
  auctionId: string
  slug: string
  success: boolean
  outcome?: 'successful_pending_claims' | 'failed_reserve'
  winnerWallet?: string
  error?: string
}

export async function endSingleAuction(auctionId: string): Promise<EndAuctionResult> {
  const auction = await getAuctionById(auctionId)
  if (!auction) return { auctionId, slug: '', success: false, error: 'Not found' }
  if (auction.status !== 'live') {
    return { auctionId, slug: auction.slug, success: false, error: `Status is ${auction.status}` }
  }
  if (new Date(auction.ends_at).getTime() > Date.now()) {
    return { auctionId, slug: auction.slug, success: false, error: 'Auction has not ended yet' }
  }

  const hasHighBid =
    !!auction.current_bid_id &&
    auction.current_bid_amount != null &&
    Number(auction.current_bid_amount) > 0

  if (!hasHighBid || !isReserveMet(auction)) {
    const failed = await markAuctionFailedReserve(auction.id)
    if (!failed) {
      return { auctionId, slug: auction.slug, success: false, error: 'Failed to mark reserve fail' }
    }
    return {
      auctionId,
      slug: auction.slug,
      success: true,
      outcome: 'failed_reserve',
    }
  }

  const gross = Number(auction.current_bid_amount)
  const { platformFee, creatorPayout } = computeAuctionSettlement(gross, auction.fee_bps_applied)
  // Winner wallet is the high bidder — load from bid id via auction fields after mark.
  const { getBidById } = await import('@/lib/db/auctions')
  const winningBid = await getBidById(auction.current_bid_id!)
  if (!winningBid || winningBid.status !== 'active') {
    const failed = await markAuctionFailedReserve(auction.id)
    if (!failed) {
      return { auctionId, slug: auction.slug, success: false, error: 'No active winning bid' }
    }
    return { auctionId, slug: auction.slug, success: true, outcome: 'failed_reserve' }
  }

  const updated = await markAuctionSuccessfulPendingClaims({
    auctionId: auction.id,
    winnerWallet: winningBid.bidder_wallet,
    winningBidId: winningBid.id,
    platformFeeAmount: platformFee,
    creatorPayoutAmount: creatorPayout,
  })
  if (!updated) {
    return { auctionId, slug: auction.slug, success: false, error: 'Failed to mark success' }
  }

  return {
    auctionId,
    slug: auction.slug,
    success: true,
    outcome: 'successful_pending_claims',
    winnerWallet: winningBid.bidder_wallet,
  }
}

export async function processEndedAuctions(): Promise<EndAuctionResult[]> {
  const due = await listAuctionsPastEndNeedingClose(25)
  const results: EndAuctionResult[] = []
  for (const auction of due) {
    try {
      results.push(await endSingleAuction(auction.id))
    } catch (e) {
      results.push({
        auctionId: auction.id,
        slug: auction.slug,
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      })
    }
  }
  return results
}
