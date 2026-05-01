/**
 * Process all ended raffles without winners: draw winner when eligible, or extend the deadline when min_tickets not met.
 * Used by admin select-winners API and by cron job so winner selection runs on a schedule.
 *
 * Works for any raffle duration (1 day, 2 days, 3 days, etc.): each raffle has its own start_time/end_time.
 * When end_time has passed and the ticket threshold (min_tickets) is met, a winner is selected; otherwise
 * the raffle may be extended once, then set to failed_refund_available (NFT returned when possible).
 */
import {
  getEndedRafflesWithoutWinner,
  getEntriesByRaffleId,
  getRaffleById,
  canSelectWinner,
  isRaffleEligibleToDraw,
  selectWinner,
  updateRaffle,
  getRaffleMinimum,
} from '@/lib/db/raffles'
import { hasExhaustedMinThresholdTimeExtensions } from '@/lib/raffles/ticket-escrow-policy'
import { buildMinThresholdMissExtensionPatch } from '@/lib/raffles/min-threshold-extension'
import { finalizeMinThresholdTerminalFailure } from '@/lib/raffles/min-threshold-terminal'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import type { Raffle } from '@/lib/types'

export type DrawResult = {
  raffleId: string
  raffleTitle: string
  success: boolean
  winnerWallet: string | null
  error: string | null
  extended?: boolean
}

/**
 * Same rules as {@link getEndedRafflesWithoutWinner}: ended, no winner, live/ready_to_draw (or legacy
 * `pending_min_not_met`), NFT deposited when NFT prize.
 * Used so opening the dashboard can advance min-threshold / refunds without relying on cron or a raffle page view.
 */
export async function processEndedRaffleByIdIfApplicable(raffleId: string): Promise<DrawResult | null> {
  const raffle = await getRaffleById(raffleId)
  if (!raffle) return null
  if (raffle.winner_wallet || raffle.winner_selected_at) return null
  if (
    raffle.status !== 'live' &&
    raffle.status !== 'ready_to_draw' &&
    raffle.status !== 'pending_min_not_met'
  ) {
    return null
  }
  const now = new Date()
  if (new Date(raffle.end_time) > now) return null
  const needsPrizeEscrow =
    (raffle.prize_type === 'nft' || isPartnerSplPrizeRaffle(raffle)) && !raffle.prize_deposited_at
  if (needsPrizeEscrow) return null
  return processOneEndedRaffle(raffle)
}

export async function processOneEndedRaffle(raffle: Raffle): Promise<DrawResult> {
  try {
    const entries = await getEntriesByRaffleId(raffle.id)
    const canDraw = canSelectWinner(raffle, entries)
    const meetsMinTickets = isRaffleEligibleToDraw(raffle, entries)

    if (!canDraw) {
      if (!meetsMinTickets) {
        if (hasExhaustedMinThresholdTimeExtensions(raffle)) {
          await finalizeMinThresholdTerminalFailure(raffle.id)
          return {
            raffleId: raffle.id,
            raffleTitle: raffle.title,
            success: false,
            winnerWallet: null,
            error:
              'Minimum was not met after the deadline extension. Ticket buyers can claim refunds; the escrowed prize is returned to the creator when the on-chain transfer succeeds.',
          }
        }
        // Threshold not met: second selling round — extend once by the original raffle duration.
        const patch = buildMinThresholdMissExtensionPatch(raffle)
        const durationMs =
          new Date(patch.end_time).getTime() - new Date(raffle.end_time).getTime()

        await updateRaffle(raffle.id, patch)

        return {
          raffleId: raffle.id,
          raffleTitle: raffle.title,
          success: false,
          winnerWallet: null,
          error: `Minimum ticket threshold not met (min: ${
            getRaffleMinimum(raffle) ?? raffle.min_tickets ?? 'N/A'
          }, sold: ${entries
            .filter((e) => e.status === 'confirmed' && !e.refunded_at)
            .reduce((sum, entry) => sum + Number(entry.ticket_quantity ?? 0), 0)}). Extended by ${
            durationMs / (24 * 60 * 60 * 1000)
          } days.`,
          extended: true,
        }
      }
      // Threshold met but caller decided not to draw yet – mark as ready_to_draw
      if (raffle.status !== 'ready_to_draw') {
        await updateRaffle(raffle.id, { status: 'ready_to_draw' })
      }
      return {
        raffleId: raffle.id,
        raffleTitle: raffle.title,
        success: false,
        winnerWallet: null,
        error: 'Raffle is ready to draw but winner selection was not run in this cycle.',
      }
    }

    const winnerWallet = await selectWinner(raffle.id)
    return {
      raffleId: raffle.id,
      raffleTitle: raffle.title,
      success: !!winnerWallet,
      winnerWallet: winnerWallet ?? null,
      error: winnerWallet ? null : 'No confirmed entries found',
    }
  } catch (error) {
    return {
      raffleId: raffle.id,
      raffleTitle: raffle.title,
      success: false,
      winnerWallet: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function processEndedRafflesWithoutWinners(): Promise<DrawResult[]> {
  const endedRaffles = await getEndedRafflesWithoutWinner()

  if (endedRaffles.length === 0) {
    return []
  }

  const results: DrawResult[] = []
  for (const raffle of endedRaffles) {
    results.push(await processOneEndedRaffle(raffle))
  }

  return results
}
