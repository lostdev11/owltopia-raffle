import { BPS_DENOMINATOR } from '@/lib/config/raffles'
import { calculateSettlement } from '@/lib/raffles/calculate-settlement'
import {
  AUCTION_MIN_INCREMENT_BPS,
  AUCTION_MIN_INCREMENT_SOL,
  AUCTION_MIN_INCREMENT_USDC,
} from '@/lib/auctions/constants'
import type { AuctionBidCurrency, NftAuction } from '@/lib/auctions/types'

export function minBidIncrementFloor(currency: AuctionBidCurrency): number {
  return currency === 'USDC' ? AUCTION_MIN_INCREMENT_USDC : AUCTION_MIN_INCREMENT_SOL
}

/**
 * Next bid must be at least max(floor, current + 5% of current) when a high bid exists,
 * otherwise start_price.
 */
export function minNextBidAmount(auction: Pick<
  NftAuction,
  'start_price' | 'current_bid_amount' | 'bid_currency'
>): number {
  const current = Number(auction.current_bid_amount)
  if (!Number.isFinite(current) || current <= 0) {
    return Number(auction.start_price)
  }
  const floor = minBidIncrementFloor(auction.bid_currency)
  const pctStep = Math.ceil(((current * AUCTION_MIN_INCREMENT_BPS) / BPS_DENOMINATOR) * 1e9) / 1e9
  const step = Math.max(floor, pctStep)
  return Math.round((current + step) * 1e9) / 1e9
}

export function isReserveMet(auction: Pick<NftAuction, 'reserve_price' | 'current_bid_amount'>): boolean {
  const reserve = auction.reserve_price
  if (reserve == null || !Number.isFinite(Number(reserve))) return true
  const current = Number(auction.current_bid_amount)
  return Number.isFinite(current) && current >= Number(reserve)
}

export function computeAuctionSettlement(winningBid: number, feeBps: number) {
  return calculateSettlement(winningBid, feeBps)
}

export function roundAuctionAmount(amount: number): number {
  return Math.round(amount * 1e9) / 1e9
}
