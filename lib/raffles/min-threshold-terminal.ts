import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { transferNftPrizeToCreator } from '@/lib/raffles/prize-escrow'

/**
 * After min_tickets was not met at end and the raffle has used its allowed deadline extension:
 * set status for ticket refunds, then attempt to return an escrowed NFT to the creator.
 * Refund claims work even if the on-chain return fails (admin can retry return).
 */
export async function finalizeMinThresholdTerminalFailure(raffleId: string): Promise<{
  nftReturnOk?: boolean
  nftReturnError?: string
}> {
  await updateRaffle(raffleId, { status: 'failed_refund_available' })

  const raffle = await getRaffleById(raffleId)
  if (!raffle) return {}

  const shouldAutoReturnNft =
    raffle.prize_type === 'nft' &&
    !!raffle.prize_deposited_at &&
    !raffle.prize_returned_at &&
    !(raffle.nft_transfer_transaction?.trim())

  if (!shouldAutoReturnNft) return {}

  const result = await transferNftPrizeToCreator(raffleId, 'min_threshold_not_met')
  if (!result.ok) {
    console.error(
      `[finalizeMinThresholdTerminalFailure] NFT return failed for raffle ${raffleId}:`,
      result.error
    )
    return { nftReturnOk: false, nftReturnError: result.error }
  }
  return { nftReturnOk: true }
}
