import { getEffectiveDrawThresholdTickets } from '@/lib/raffles/nft-raffle-economics'
import { isRaffleSoldOutAtMax } from '@/lib/raffles/max-tickets'
import type { Entry, Raffle } from '@/lib/types'

function confirmedTicketCount(entries: Entry[]): number {
  return entries
    .filter((e) => e.status === 'confirmed' && !e.refunded_at)
    .reduce((sum, entry) => sum + Number(entry.ticket_quantity ?? 0), 0)
}

/**
 * Whether a winner may be selected now: draw threshold met, or ticket cap sold out with ≥1 ticket.
 * Legacy rows may have max_tickets below the current computed draw goal — still draw at cap.
 */
export function isRaffleEligibleForWinnerSelection(
  raffle: Pick<Raffle, 'max_tickets' | 'min_tickets' | 'prize_type' | 'floor_price' | 'ticket_price'>,
  entries: Entry[]
): boolean {
  const confirmedTickets = confirmedTicketCount(entries)
  if (confirmedTickets <= 0) return false

  const min = getEffectiveDrawThresholdTickets(raffle as Raffle)
  if (min != null && min > 0) {
    if (confirmedTickets >= min) return true
    return isRaffleSoldOutAtMax(raffle, confirmedTickets)
  }

  return confirmedTickets > 0
}

/** Sell-out hook alias — same eligibility rules as {@link isRaffleEligibleForWinnerSelection}. */
export function canDrawOnSellOut(
  raffle: Pick<Raffle, 'max_tickets' | 'min_tickets' | 'prize_type' | 'floor_price' | 'ticket_price'>,
  entries: Entry[]
): boolean {
  return isRaffleEligibleForWinnerSelection(raffle, entries)
}
