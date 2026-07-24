/** Max concurrent live auctions per partner/admin creator wallet. */
export const AUCTION_MAX_LIVE_PER_CREATOR = 3

/** Soft-close: extend when a bid lands inside this window. */
export const AUCTION_SOFT_CLOSE_WINDOW_MS = 5 * 60 * 1000

/** Each soft-close extension length. */
export const AUCTION_SOFT_CLOSE_EXTENSION_MS = 5 * 60 * 1000

/** Cap soft-close extensions so auctions cannot run forever. */
export const AUCTION_SOFT_CLOSE_MAX_EXTENSIONS = 3

/** Allowed duration presets (ms) from starts_at. */
export const AUCTION_DURATION_PRESETS_MS = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
} as const

export type AuctionDurationPreset = keyof typeof AUCTION_DURATION_PRESETS_MS

/** Absolute min bid increment floors. */
export const AUCTION_MIN_INCREMENT_SOL = 0.01
export const AUCTION_MIN_INCREMENT_USDC = 1

/** Percentage increment of current high (bps). 500 = 5%. */
export const AUCTION_MIN_INCREMENT_BPS = 500

/** Pending bid deposit must be confirmed within this window. */
export const AUCTION_PENDING_BID_TTL_MS = 30 * 60 * 1000
