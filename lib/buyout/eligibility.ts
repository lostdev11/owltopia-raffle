import type { Raffle } from '@/lib/types'

/**
 * True when this raffle can show the buyout UI and accept new bids (v1: post-draw only).
 * Requires NFT prize still in platform flow (winner not yet transferred prize out).
 */
export function isRaffleBuyoutWindowOpen(raffle: Raffle): boolean {
  if (raffle.prize_type !== 'nft') return false
  if (!raffle.nft_mint_address?.trim()) return false
  if (!raffle.winner_wallet?.trim()) return false
  if (!raffle.prize_deposited_at) return false
  if (raffle.prize_returned_at) return false
  if (raffle.buyout_closed_at) return false
  if (raffle.nft_transfer_transaction?.trim()) return false

  const endMs = new Date(raffle.end_time).getTime()
  if (Number.isNaN(endMs) || endMs > Date.now()) return false

  const badStatus =
    raffle.status === 'cancelled' ||
    raffle.status === 'draft' ||
    raffle.status === 'failed_refund_available' ||
    raffle.status === 'pending_min_not_met'
  if (badStatus) return false

  return true
}
