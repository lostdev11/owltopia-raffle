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

export type SellOutDrawPreconditionInput = {
  max_tickets: number | null
  status: string | null
  winner_wallet?: string | null
  winner_selected_at?: string | null
  confirmedTickets: number
  canDraw: boolean
  prizeRequiresEscrow: boolean
  prizeDeposited: boolean
}

/** Pure preconditions for sell-out early draw (testable without DB). Returns null when eligible. */
export function getSellOutDrawSkipReason(
  input: SellOutDrawPreconditionInput
): SellOutDrawSkipReason | null {
  if (input.winner_wallet || input.winner_selected_at) return 'already_drawn'
  if (input.max_tickets == null || input.max_tickets <= 0) return 'no_max'
  const status = (input.status ?? '').trim().toLowerCase()
  if (status !== 'live' && status !== 'ready_to_draw') return 'wrong_status'
  if (!isRaffleSoldOutAtMax({ max_tickets: input.max_tickets }, input.confirmedTickets)) {
    return 'not_sold_out'
  }
  if (input.prizeRequiresEscrow && !input.prizeDeposited) return 'prize_not_deposited'
  if (!input.canDraw) return 'threshold_not_met'
  return null
}

/**
 * When confirmed tickets reach max_tickets and the draw threshold is met, move to ready_to_draw
 * and run the standard draw pipeline immediately (do not wait for end_time).
 */
export async function maybeTriggerDrawOnSellOut(raffleId: string): Promise<SellOutDrawResult> {
  const raffle = await getRaffleById(raffleId)
  if (!raffle) return { triggered: false, reason: 'wrong_status' }

  const entries = await getEntriesByRaffleId(raffleId)
  const confirmedTickets = calculateTicketsSold(entries)
  const skipReason = getSellOutDrawSkipReason({
    max_tickets: raffle.max_tickets,
    status: raffle.status,
    winner_wallet: raffle.winner_wallet,
    winner_selected_at: raffle.winner_selected_at,
    confirmedTickets,
    canDraw: canSelectWinner(raffle, entries),
    prizeRequiresEscrow:
      raffle.prize_type === 'nft' || isPartnerSplPrizeRaffle(raffle),
    prizeDeposited: Boolean(raffle.prize_deposited_at),
  })

  if (skipReason === 'threshold_not_met') {
    console.warn('[sell-out-draw] sold out at max but draw threshold not met', {
      raffleId,
      confirmedTickets,
      maxTickets: raffle.max_tickets,
    })
  }

  if (skipReason != null) {
    return { triggered: false, reason: skipReason }
  }

  const status = (raffle.status ?? '').trim().toLowerCase()
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
