import { isReserveMet, minNextBidAmount } from '@/lib/auctions/economics'
import type { NftAuction, NftAuctionPublic } from '@/lib/auctions/types'

/** Strip hidden reserve for partner clients; keep has_reserve + reserve_met. */
export function toPublicAuction(auction: NftAuction): NftAuctionPublic {
  const hasReserve = auction.reserve_price != null && Number(auction.reserve_price) > 0
  const reserveMet = isReserveMet(auction)
  return {
    ...auction,
    reserve_price: auction.reserve_hidden ? null : auction.reserve_price,
    has_reserve: hasReserve,
    reserve_met: reserveMet,
    min_next_bid: minNextBidAmount(auction),
  }
}
