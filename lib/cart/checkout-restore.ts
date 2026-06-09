import type { CartLine } from './types'

/**
 * Decide which cart lines survive a checkout attempt.
 *
 * Two classes of "done" raffle IDs, both removed from the cart:
 * - settled:        verified (or 202 async-pending) — tickets are/will be confirmed.
 * - paidUnverified: the wallet broadcast a payment but verify did not finish
 *   (confirm timeout, verify network drop, verify 4xx). Restoring these lines
 *   would put a paid item back behind the checkout button — a double-payment
 *   footgun, especially on mobile where users retry after a confusing wallet
 *   round-trip. The pending-verification resume path recovers them instead.
 *
 * Lines from batches never attempted (no signature) ARE restored.
 */
export function computeCartLinesAfterBatchCheckout(
  initialLines: readonly CartLine[],
  settledRaffleIds: readonly string[],
  paidUnverifiedRaffleIds: readonly string[]
): CartLine[] {
  const done = new Set([...settledRaffleIds, ...paidUnverifiedRaffleIds])
  return initialLines.filter(line => !done.has(line.raffleId))
}

/** Appended to post-payment failure errors so users know not to pay again. */
export const PAID_UNVERIFIED_CART_NOTE =
  'Those tickets were removed from your cart — do not pay again. They will confirm automatically; check your entries in a minute (keep this site open on WiFi or mobile data).'
