/**
 * Classify ended raffles that still lack a winner — used by the dashboard so
 * draw (often VRF, ~75s) is not confused with min-threshold extension/refund.
 */
import { isRaffleEligibleForWinnerSelection } from '@/lib/raffles/sell-out-eligibility'
import { raffleIsDueForWinnerDraw } from '@/lib/raffles/purchase-window'
import { raffleRequiresPrizeEscrowForDraw } from '@/lib/raffles/visibility'
import type { Entry, Raffle } from '@/lib/types'

export type EndedFinalizingKind = 'awaiting_draw' | 'awaiting_extension_or_refund'

export type EndedFinalizingItem = {
  id: string
  slug: string
  title: string
  kind: EndedFinalizingKind
}

/**
 * Returns how an ended undrawn raffle should be explained in the UI, or null if
 * it is not in the ended-no-winner processable set.
 */
export function classifyEndedNoWinnerRaffle(
  raffle: Pick<
    Raffle,
    | 'id'
    | 'winner_wallet'
    | 'winner_selected_at'
    | 'status'
    | 'end_time'
    | 'prize_type'
    | 'prize_deposited_at'
    | 'prize_currency'
    | 'max_tickets'
    | 'min_tickets'
    | 'floor_price'
    | 'ticket_price'
  >,
  entries: Entry[],
  now: Date | number = new Date()
): EndedFinalizingKind | null {
  if (
    (raffle.winner_wallet && String(raffle.winner_wallet).trim()) ||
    (raffle.winner_selected_at && String(raffle.winner_selected_at).trim())
  ) {
    return null
  }
  const status = (raffle.status ?? '').trim()
  if (status !== 'live' && status !== 'ready_to_draw' && status !== 'pending_min_not_met') {
    return null
  }
  const nowDate = typeof now === 'number' ? new Date(now) : now
  if (!raffleIsDueForWinnerDraw(raffle, nowDate)) return null
  if (raffleRequiresPrizeEscrowForDraw(raffle as Raffle) && !raffle.prize_deposited_at) {
    return null
  }
  if (isRaffleEligibleForWinnerSelection(raffle, entries)) {
    return 'awaiting_draw'
  }
  return 'awaiting_extension_or_refund'
}
