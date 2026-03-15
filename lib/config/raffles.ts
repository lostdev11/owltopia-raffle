/**
 * Platform fee (deducted from every ticket sale).
 * - 3% for raffle creators who hold the Owltopia (Owl) NFT.
 * - 6% for non-holders.
 * Applied at purchase time via getPaymentSplit and at settlement.
 */
export const HOLDER_FEE_BPS = 300   // 3%
export const STANDARD_FEE_BPS = 600 // 6%

// Owltopia NFT collection address for holder check (3% vs 6% fee).
// Set via OWLTOPIA_COLLECTION_ADDRESS or NEXT_PUBLIC_OWLTOPIA_COLLECTION_ADDRESS in env.
const RAW =
  typeof process !== 'undefined' && process.env?.OWLTOPIA_COLLECTION_ADDRESS?.trim() ||
  typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_OWLTOPIA_COLLECTION_ADDRESS?.trim() ||
  ''
export const OWLTOPIA_COLLECTION_ADDRESS = RAW || 'REPLACE_WITH_COLLECTION'

export const BPS_DENOMINATOR = 10_000

/** Hours after raffle creation during which cancellation has no fee to host. Ticket buyers get refunds in all cases (treasury sends). */
export const FULL_REFUND_WINDOW_HOURS = 24

/** Cancellation fee (SOL) charged to the host when cancelled after this window. Override via CANCELLATION_FEE_SOL. */
const DEFAULT_CANCELLATION_FEE_SOL = 0.1
export function getCancellationFeeSol(): number {
  const raw = typeof process !== 'undefined' && process.env?.CANCELLATION_FEE_SOL?.trim()
  if (raw) {
    const n = parseFloat(raw)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return DEFAULT_CANCELLATION_FEE_SOL
}

