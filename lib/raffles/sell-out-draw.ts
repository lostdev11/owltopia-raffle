import {
  calculateTicketsSold,
  canSelectWinner,
  getEntriesByRaffleId,
  getRaffleById,
  updateRaffle,
} from '@/lib/db/raffles'
import { processEndedRaffleByIdIfApplicable, type DrawResult } from '@/lib/draw-ended-raffles'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import { isRaffleSoldOutAtMax } from '@/lib/raffles/max-tickets'

export type SellOutDrawSkipReason =
  | 'not_sold_out'
  | 'no_max'
  | 'already_drawn'
  | 'threshold_not_met'
  | 'prize_not_deposited'
  | 'wrong_status'
  | 'draw_pipeline_skipped'

export type SellOutDrawResult =
  | { triggered: false; reason: SellOutDrawSkipReason }
  | { triggered: true; draw: DrawResult }

/**
 * When confirmed tickets reach max_tickets and the draw threshold is met, move to ready_to_draw
 * and run the standard draw pipeline immediately (do not wait for end_time).
 */
export async function maybeTriggerDrawOnSellOut(raffleId: string): Promise<SellOutDrawResult> {
  const raffle = await getRaffleById(raffleId)
  if (!raffle) return { triggered: false, reason: 'wrong_status' }
  if (raffle.winner_wallet || raffle.winner_selected_at) {
    return { triggered: false, reason: 'already_drawn' }
  }
  if (raffle.max_tickets == null || raffle.max_tickets <= 0) {
    return { triggered: false, reason: 'no_max' }
  }
  const status = (raffle.status ?? '').trim().toLowerCase()
  if (status !== 'live' && status !== 'ready_to_draw') {
    return { triggered: false, reason: 'wrong_status' }
  }

  const entries = await getEntriesByRaffleId(raffleId)
  const confirmedTickets = calculateTicketsSold(entries)
  if (!isRaffleSoldOutAtMax(raffle, confirmedTickets)) {
    return { triggered: false, reason: 'not_sold_out' }
  }

  const needsPrizeEscrow =
    (raffle.prize_type === 'nft' || isPartnerSplPrizeRaffle(raffle)) && !raffle.prize_deposited_at
  if (needsPrizeEscrow) {
    return { triggered: false, reason: 'prize_not_deposited' }
  }

  if (!canSelectWinner(raffle, entries)) {
    console.warn('[sell-out-draw] sold out at max but draw threshold not met', {
      raffleId,
      confirmedTickets,
      maxTickets: raffle.max_tickets,
    })
    return { triggered: false, reason: 'threshold_not_met' }
  }

  if (status === 'live') {
    await updateRaffle(raffleId, { status: 'ready_to_draw' })
  }

  const draw = await processEndedRaffleByIdIfApplicable(raffleId)
  if (!draw) {
    return {
      triggered: true,
      draw: {
        raffleId,
        raffleTitle: raffle.title,
        success: false,
        winnerWallet: null,
        error: 'Sell-out draw pipeline did not run',
      },
    }
  }

  return { triggered: true, draw }
}
