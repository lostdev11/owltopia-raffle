/**
 * Process all ended raffles without winners: draw winner when eligible, or extend by 7 days when min not met.
 * Used by admin select-winners API and by cron job so winner selection runs on a schedule.
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
          const endTime = new Date(raffle.end_time)
          const originalEndTime = raffle.original_end_time || raffle.end_time
          const newEndTime = new Date(endTime)
          newEndTime.setDate(newEndTime.getDate() + 7)

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
            error: `Minimum requirements not met (min: ${raffle.min_tickets ?? 'N/A'}, sold: ${entries.filter(e => e.status === 'confirmed').reduce((sum, entry) => sum + entry.ticket_quantity, 0)}). Extended by 7 days.`,
            extended: true,
          })
        } else {
          results.push({
            raffleId: raffle.id,
            raffleTitle: raffle.title,
            success: false,
            winnerWallet: null,
            error: 'Raffle must wait 7 days after original end time before drawing winner',
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
