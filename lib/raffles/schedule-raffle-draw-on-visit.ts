import { after } from 'next/server'
import { processEndedRaffleByIdIfApplicable } from '@/lib/draw-ended-raffles'
import { raffleIsDueForWinnerDraw } from '@/lib/raffles/purchase-window'
import { raffleRequiresPrizeEscrowForDraw } from '@/lib/raffles/visibility'
import type { Raffle } from '@/lib/types'

function raffleMayAutoDrawOnVisit(raffle: Raffle): boolean {
  if (raffle.winner_wallet || raffle.winner_selected_at) return false
  const status = (raffle.status ?? '').trim().toLowerCase()
  if (status !== 'live' && status !== 'ready_to_draw' && status !== 'pending_min_not_met') {
    return false
  }
  if (raffleRequiresPrizeEscrowForDraw(raffle) && !raffle.prize_deposited_at) return false
  return true
}

/** Draw / min-threshold pipeline for one raffle (sell-out repair + ended processing). */
export async function runRaffleDrawOnVisit(raffle: Raffle): Promise<void> {
  if (!raffleMayAutoDrawOnVisit(raffle)) return

  const raffleId = raffle.id
  const hasEnded = raffleIsDueForWinnerDraw(raffle)
  const status = (raffle.status ?? '').trim().toLowerCase()
  const mayRepairSellOut = status === 'live' || status === 'ready_to_draw'

  if (mayRepairSellOut) {
    const { maybeTriggerDrawOnSellOut } = await import('@/lib/raffles/sell-out-draw')
    await maybeTriggerDrawOnSellOut(raffleId)
  }
  if (hasEnded) {
    await processEndedRaffleByIdIfApplicable(raffleId)
  }
}

/**
 * Kick off draw / min-threshold processing after the raffle page response is sent.
 * Client also POSTs `/api/raffles/[id]/process-ended` as a reliable fallback when `after()` is cut short.
 */
export function scheduleRaffleDrawOnVisit(raffle: Raffle): void {
  if (!raffleMayAutoDrawOnVisit(raffle)) return

  after(async () => {
    try {
      await runRaffleDrawOnVisit(raffle)
    } catch (err) {
      console.error('[scheduleRaffleDrawOnVisit]', raffle.id, err)
    }
  })
}
