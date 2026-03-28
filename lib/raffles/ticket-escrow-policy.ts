import type { Raffle } from '@/lib/types'

/** True when ticket gross must be verified as paid into the funds escrow wallet. */
export function raffleUsesFundsEscrow(raffle: {
  ticket_payments_to_funds_escrow?: boolean | null
}): boolean {
  return raffle.ticket_payments_to_funds_escrow === true
}

/** True after first time-extension (end_time extended past original_end_time). */
export function hasRaffleAlreadyBeenTimeExtended(raffle: Raffle): boolean {
  const orig = raffle.original_end_time
  const end = raffle.end_time
  if (!orig || !end) return false
  const origMs = new Date(orig).getTime()
  const endMs = new Date(end).getTime()
  if (Number.isNaN(origMs) || Number.isNaN(endMs)) return false
  return endMs > origMs + 2_000
}
