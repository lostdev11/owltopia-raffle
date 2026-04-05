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
  canSelectWinner,
  isRaffleEligibleToDraw,
  selectWinner,
  updateRaffle,
  getRaffleMinimum,
} from '@/lib/db/raffles'
import { hasExhaustedMinThresholdTimeExtensions } from '@/lib/raffles/ticket-escrow-policy'
import { finalizeMinThresholdTerminalFailure } from '@/lib/raffles/min-threshold-terminal'

export type DrawResult = {
  raffleId: string
  raffleTitle: string
  success: boolean
  winnerWallet: string | null
  error: string | null
  extended?: boolean
}

export async function processEndedRafflesWithoutWinners(): Promise<DrawResult[]> {
  const endedRaffles = await getEndedRafflesWithoutWinner()

  if (endedRaffles.length === 0) {
    return []
  }

  const results: DrawResult[] = []

  for (const raffle of endedRaffles) {
    try {
      const entries = await getEntriesByRaffleId(raffle.id)
      const canDraw = canSelectWinner(raffle, entries)
      const meetsMinTickets = isRaffleEligibleToDraw(raffle, entries)

      if (!canDraw) {
        if (!meetsMinTickets) {
          if (hasExhaustedMinThresholdTimeExtensions(raffle)) {
            await finalizeMinThresholdTerminalFailure(raffle.id)
            results.push({
              raffleId: raffle.id,
              raffleTitle: raffle.title,
              success: false,
              winnerWallet: null,
              error:
                'Minimum was not met after the deadline extension. Ticket buyers can claim refunds; NFT prize is returned to the creator when escrow transfer succeeds.',
            })
          } else {
            // Threshold not met: extend raffle by its original duration (or 7 days fallback)
            const originalEndTime = raffle.original_end_time || raffle.end_time
            const startTimeMs = new Date(raffle.start_time).getTime()
            const originalEndMs = new Date(originalEndTime).getTime()
            const baseDurationMs = originalEndMs - startTimeMs
            const durationMs =
              baseDurationMs > 0 ? baseDurationMs : 7 * 24 * 60 * 60 * 1000

            const currentEndMs = new Date(raffle.end_time).getTime()
            const newEndTime = new Date(currentEndMs + durationMs)

            await updateRaffle(raffle.id, {
              original_end_time: originalEndTime,
              end_time: newEndTime.toISOString(),
              status: 'live',
              time_extension_count: (raffle.time_extension_count ?? 0) + 1,
            })

            results.push({
              raffleId: raffle.id,
              raffleTitle: raffle.title,
              success: false,
              winnerWallet: null,
              error: `Minimum ticket threshold not met (min: ${
                getRaffleMinimum(raffle) ?? raffle.min_tickets ?? 'N/A'
              }, sold: ${entries
                .filter((e) => e.status === 'confirmed')
                .reduce((sum, entry) => sum + Number(entry.ticket_quantity ?? 0), 0)}). Extended by ${
                durationMs / (24 * 60 * 60 * 1000)
              } days.`,
              extended: true,
            })
          }
        } else {
          // Threshold met but caller decided not to draw yet – mark as ready_to_draw
          if (raffle.status !== 'ready_to_draw') {
            await updateRaffle(raffle.id, { status: 'ready_to_draw' })
          }
          results.push({
            raffleId: raffle.id,
            raffleTitle: raffle.title,
            success: false,
            winnerWallet: null,
            error:
              'Raffle is ready to draw but winner selection was not run in this cycle.',
          })
        }
        continue
      }

      const winnerWallet = await selectWinner(raffle.id)
      results.push({
        raffleId: raffle.id,
        raffleTitle: raffle.title,
        success: !!winnerWallet,
        winnerWallet: winnerWallet ?? null,
        error: winnerWallet ? null : 'No confirmed entries found',
      })
    } catch (error) {
      results.push({
        raffleId: raffle.id,
        raffleTitle: raffle.title,
        success: false,
        winnerWallet: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return results
}
