import type { Raffle } from '@/lib/types'

type RaffleSoldOutFields = Pick<
  Raffle,
  'status' | 'winner_wallet' | 'winner_selected_at' | 'max_tickets'
>

/** Sold out at max cap, winner not drawn yet (incl. ready_to_draw before scheduled end). */
export function raffleIsSoldOutAwaitingDraw(
  raffle: RaffleSoldOutFields,
  availableTickets: number | null
): boolean {
  if (raffle.winner_wallet || raffle.winner_selected_at) return false
  if (raffle.max_tickets == null) return false
  if (availableTickets === null || availableTickets > 0) return false
  const status = (raffle.status ?? '').trim().toLowerCase()
  return status === 'live' || status === 'ready_to_draw'
}

/** Purchase button label when ticket cap is exhausted. */
export function raffleSoldOutButtonLabel(
  raffle: RaffleSoldOutFields,
  availableTickets: number | null
): string {
  if (availableTickets !== null && availableTickets > 0) return 'Sold Out'
  if (raffle.winner_wallet || raffle.winner_selected_at) return 'Sold Out'
  if (raffle.max_tickets != null) return 'Sold Out — Draw Pending'
  return 'Sold Out'
}

/** Detail helper under "Tickets Available" when cap is hit. */
export function raffleSoldOutDetailMessage(
  raffle: RaffleSoldOutFields,
  availableTickets: number | null
): string {
  if (availableTickets === null || availableTickets > 0) return ''
  if (raffle.winner_wallet || raffle.winner_selected_at) {
    return 'All tickets have been sold'
  }
  if (raffle.max_tickets != null) {
    return 'All tickets sold — winner draw in progress (no need to wait for the scheduled end time)'
  }
  return 'All tickets have been sold'
}
