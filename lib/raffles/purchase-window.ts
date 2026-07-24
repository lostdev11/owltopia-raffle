/**
 * Ticket purchase window helpers.
 *
 * The raffle detail UI hides Buy when `start_time` is still in the future, but
 * cart checkout and entry create APIs must enforce the same rule server-side —
 * otherwise buyers can enter "upcoming" raffles via `/cart` before they open.
 */

export type RafflePurchaseWindowFields = {
  start_time?: string | null
  end_time?: string | null
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
