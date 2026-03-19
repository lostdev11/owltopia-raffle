/**
 * Process all ended raffles without winners: draw winner when eligible, or extend by 7 days when min not met.
 * Used by admin select-winners API and by cron job so winner selection runs on a schedule.
 *
 * Works for any raffle duration (1 day, 2 days, 3 days, etc.): each raffle has its own start_time/end_time.
 * When end_time has passed and threshold (min_tickets) is met, a winner is selected; otherwise the raffle
 * is extended or set to ready_to_draw as per the 7-day extension rules.
 */
import {
  getEndedRafflesWithoutWinner,
  getEntriesByRaffleId,
  canSelectWinner,
  isRaffleEligibleToDraw,
  selectWinner,
  updateRaffle,
} from '@/lib/db/raffles'

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
          })

          results.push({
            raffleId: raffle.id,
            raffleTitle: raffle.title,
            success: false,
            winnerWallet: null,
            error: `Minimum requirements not met (min: ${
              raffle.min_tickets ?? 'N/A'
            }, sold: ${entries
              .filter((e) => e.status === 'confirmed')
              .reduce((sum, entry) => sum + entry.ticket_quantity, 0)}). Extended by ${
              durationMs / (24 * 60 * 60 * 1000)
            } days.`,
            extended: true,
          })
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
