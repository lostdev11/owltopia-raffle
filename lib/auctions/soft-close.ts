import {
  AUCTION_SOFT_CLOSE_EXTENSION_MS,
  AUCTION_SOFT_CLOSE_MAX_EXTENSIONS,
  AUCTION_SOFT_CLOSE_WINDOW_MS,
} from '@/lib/auctions/constants'
import type { NftAuction } from '@/lib/auctions/types'

export function computeSoftCloseUpdate(
  auction: Pick<NftAuction, 'ends_at' | 'soft_close_extensions'>
): { endsAt: string; extensions: number } | null {
  const endsAtMs = new Date(auction.ends_at).getTime()
  if (!Number.isFinite(endsAtMs)) return null
  const remaining = endsAtMs - Date.now()
  if (remaining > AUCTION_SOFT_CLOSE_WINDOW_MS || remaining < 0) return null
  if (auction.soft_close_extensions >= AUCTION_SOFT_CLOSE_MAX_EXTENSIONS) return null
  const nextEnds = endsAtMs + AUCTION_SOFT_CLOSE_EXTENSION_MS
  return {
    endsAt: new Date(nextEnds).toISOString(),
    extensions: auction.soft_close_extensions + 1,
  }
}
