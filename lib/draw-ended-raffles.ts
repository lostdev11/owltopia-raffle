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
  getRaffleById,
} from '@/lib/db/raffles'
import { transferNftPrizeToWinner } from '@/lib/raffles/prize-escrow'

export type DrawResult = {
  raffleId: string
  raffleTitle: string
  success: boolean
  winnerWallet: string | null
  error: string | null
  extended?: boolean
  /** NFT prize transfer tx signature (if prize escrow is used and transfer succeeded). */
  nftTransferSignature?: string | null
  /** Error from automatic NFT transfer to winner (if any). */
  nftTransferError?: string | null
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
          // Threshold met but 7 days not passed since original end — mark as ready_to_draw so raffle is visibly ended
          if (raffle.status !== 'ready_to_draw') {
            await updateRaffle(raffle.id, { status: 'ready_to_draw' })
          }
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
      let nftTransferSignature: string | null = null
      let nftTransferError: string | null = null
      if (winnerWallet) {
        const updated = await getRaffleById(raffle.id)
        if (updated?.prize_type === 'nft' && updated.nft_mint_address && !updated.nft_transfer_transaction) {
          const transferResult = await transferNftPrizeToWinner(raffle.id)
          if (transferResult.ok && transferResult.signature) {
            nftTransferSignature = transferResult.signature
          } else if (!transferResult.ok && transferResult.error) {
            nftTransferError = transferResult.error
            console.error(`[draw-ended-raffles] NFT transfer failed for raffle ${raffle.id}:`, transferResult.error)
          }
        }
      }
      results.push({
        raffleId: raffle.id,
        raffleTitle: raffle.title,
        success: !!winnerWallet,
        winnerWallet: winnerWallet ?? null,
        error: winnerWallet ? null : 'No confirmed entries found',
        nftTransferSignature: nftTransferSignature ?? undefined,
        nftTransferError: nftTransferError ?? undefined,
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
