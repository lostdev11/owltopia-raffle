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

/**
 * Kick off draw / min-threshold processing after the raffle page response is sent.
 * Avoids blocking SSR on VRF (up to ~75s) which left detail URLs stuck on "Loading raffles...".
 */
export function scheduleRaffleDrawOnVisit(raffle: Raffle): void {
  if (!raffleMayAutoDrawOnVisit(raffle)) return

  const raffleId = raffle.id
  const hasEnded = raffleIsDueForWinnerDraw(raffle)
  const status = (raffle.status ?? '').trim().toLowerCase()
  const mayRepairSellOut = status === 'live' || status === 'ready_to_draw'

  after(async () => {
    try {
      if (mayRepairSellOut) {
        const { maybeTriggerDrawOnSellOut } = await import('@/lib/raffles/sell-out-draw')
        await maybeTriggerDrawOnSellOut(raffleId)
      }
      if (hasEnded) {
        await processEndedRaffleByIdIfApplicable(raffleId)
      }
    } catch (err) {
      console.error('[scheduleRaffleDrawOnVisit]', raffleId, err)
    }
  })
}
