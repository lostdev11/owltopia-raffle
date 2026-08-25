/**
 * Ticket purchase window helpers.
 *
 * The raffle detail UI hides Buy when `start_time` is still in the future, but
 * cart checkout and entry create APIs must enforce the same rule server-side —
 * otherwise buyers can enter "upcoming" raffles via `/cart` before they open.
 *
 * Also: once status moves off `live` (e.g. `ready_to_draw` after a failed VRF),
 * sales must stop even if an admin pushed `end_time` into the future — otherwise
 * the frozen draw ledger diverges from confirmed tickets.
 */

export type RafflePurchaseWindowFields = {
  start_time?: string | null
  end_time?: string | null
  status?: string | null
  is_active?: boolean | null
}

/** True when `start_time` has passed (or is missing/invalid is treated as not started). */
export function raffleHasStarted(
  raffle: Pick<RafflePurchaseWindowFields, 'start_time'>,
  now: Date = new Date()
): boolean {
  const raw = raffle.start_time?.trim()
  if (!raw) return false
  const startMs = new Date(raw).getTime()
  if (!Number.isFinite(startMs)) return false
  return startMs <= now.getTime()
}

/** True when `end_time` has passed. */
export function raffleHasEnded(
  raffle: Pick<RafflePurchaseWindowFields, 'end_time'>,
  now: Date = new Date()
): boolean {
  const raw = raffle.end_time?.trim()
  if (!raw) return true
  const endMs = new Date(raw).getTime()
  if (!Number.isFinite(endMs)) return true
  return endMs <= now.getTime()
}

/**
 * Whether new ticket purchases are within the scheduled window
 * (`start_time` ≤ now < `end_time`). Does not check `is_active`, escrow, etc.
 */
export function raffleIsWithinPurchaseWindow(
  raffle: RafflePurchaseWindowFields,
  now: Date = new Date()
): boolean {
  return raffleHasStarted(raffle, now) && !raffleHasEnded(raffle, now)
}

/**
 * Status gate for ticket sales. Only `live` listings accept new purchases.
 * `ready_to_draw` / completed / cancelled / draft must not sell more tickets.
 */
export function raffleStatusAllowsTicketPurchases(
  raffle: Pick<RafflePurchaseWindowFields, 'status'>
): boolean {
  return (raffle.status ?? '').trim().toLowerCase() === 'live'
}

/**
 * Combined schedule + status check used by entry create APIs.
 */
export function raffleAcceptsTicketPurchases(
  raffle: RafflePurchaseWindowFields,
  now: Date = new Date()
): boolean {
  if (!raffleStatusAllowsTicketPurchases(raffle)) return false
  if (raffle.is_active === false) return false
  return raffleIsWithinPurchaseWindow(raffle, now)
}

/**
 * True when the listing should run (or retry) winner selection now.
 * `ready_to_draw` means sales are done and a draw is owed — even if an admin
 * incorrectly pushed `end_time` into the future after a failed VRF attempt.
 */
export function raffleIsDueForWinnerDraw(
  raffle: Pick<RafflePurchaseWindowFields, 'end_time' | 'status'>,
  now: Date = new Date()
): boolean {
  const status = (raffle.status ?? '').trim().toLowerCase()
  if (status === 'ready_to_draw') return true
  return raffleHasEnded(raffle, now)
}

/**
 * True when the winner may claim the escrowed prize (dashboard + claim-prize API).
 *
 * Sell-out early draw moves status to `successful_pending_claims` immediately while
 * the scheduled `end_time` is still in the future — claims must open right after the
 * draw, not wait for the original end clock.
 */
export function raffleWinnerPrizeClaimWindowOpen(
  raffle: Pick<RafflePurchaseWindowFields, 'end_time' | 'status'>,
  now: Date = new Date()
): boolean {
  const status = (raffle.status ?? '').trim().toLowerCase()
  if (status === 'successful_pending_claims' || status === 'completed') return true
  return raffleHasEnded(raffle, now)
}
