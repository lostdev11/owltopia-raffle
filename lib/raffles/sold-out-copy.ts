import type { Raffle } from '@/lib/types'

type RaffleSoldOutFields = Pick<
  Raffle,
  'status' | 'winner_wallet' | 'winner_selected_at' | 'max_tickets'
>

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
