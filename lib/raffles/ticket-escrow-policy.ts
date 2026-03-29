import type { Raffle } from '@/lib/types'

/** Max automatic deadline extensions when min_tickets is not met at end; then refunds + NFT return. */
export const MAX_MIN_THRESHOLD_TIME_EXTENSIONS = 2

/** True when ticket gross must be verified as paid into the funds escrow wallet. */
export function raffleUsesFundsEscrow(raffle: {
  ticket_payments_to_funds_escrow?: boolean | null
}): boolean {
  return raffle.ticket_payments_to_funds_escrow === true
}

/** True after the raffle has already been extended the maximum times for min-threshold misses. */
export function hasExhaustedMinThresholdTimeExtensions(raffle: Raffle): boolean {
  const n = raffle.time_extension_count ?? 0
  return n >= MAX_MIN_THRESHOLD_TIME_EXTENSIONS
}

/** True after first time-extension (end_time extended past original_end_time). UI / diagnostics. */
export function hasRaffleAlreadyBeenTimeExtended(raffle: Raffle): boolean {
  const orig = raffle.original_end_time
  const end = raffle.end_time
  if (!orig || !end) return false
  const origMs = new Date(orig).getTime()
  const endMs = new Date(end).getTime()
  if (Number.isNaN(origMs) || Number.isNaN(endMs)) return false
  return endMs > origMs + 2_000
}
