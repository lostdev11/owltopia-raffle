import type { Raffle } from '@/lib/types'
import {
  getRaffleById,
  updateRaffle,
  getEntriesByRaffleId,
  canSelectWinner,
} from '@/lib/db/raffles'
import { transferNftPrizeToCreator, transferPartnerSplPrizeToCreator } from '@/lib/raffles/prize-escrow'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import { hasExhaustedMinThresholdTimeExtensions } from '@/lib/raffles/ticket-escrow-policy'

/**
 * Terminal min-threshold failure (the “2nd round” deadline, after the one automatic extension):
 *
 * 1. If the draw threshold is still not met when the extended `end_time` passes, the raffle is closed.
 * 2. Status → `failed_refund_available` so ticket buyers can claim refunds (see claim-refund / funds escrow).
 * 3. For an escrowed NFT or partner SPL prize, we try to return it to the creator on-chain; if that fails,
 *    the creator can use `POST /api/raffles/[id]/claim-failed-min-prize-return` (same as dashboard “claim prize back”).
 *
 * Refunds do not depend on the NFT return succeeding.
 */
export async function finalizeMinThresholdTerminalFailure(raffleId: string): Promise<{
  nftReturnOk?: boolean
  nftReturnError?: string
}> {
  await updateRaffle(raffleId, { status: 'failed_refund_available', is_active: false })

  const raffle = await getRaffleById(raffleId)
  if (!raffle) return {}

  const shouldAutoReturnNft =
    raffle.prize_type === 'nft' &&
    !!raffle.prize_deposited_at &&
    !raffle.prize_returned_at &&
    !(raffle.nft_transfer_transaction?.trim())

  const shouldAutoReturnPartnerSpl =
    isPartnerSplPrizeRaffle(raffle) &&
    !!raffle.prize_deposited_at &&
    !raffle.prize_returned_at &&
    !(raffle.nft_transfer_transaction?.trim())

  if (!shouldAutoReturnNft && !shouldAutoReturnPartnerSpl) return {}

  const result = shouldAutoReturnPartnerSpl
    ? await transferPartnerSplPrizeToCreator(raffleId, 'min_threshold_not_met')
    : await transferNftPrizeToCreator(raffleId, 'min_threshold_not_met')
  if (!result.ok) {
    console.error(
      `[finalizeMinThresholdTerminalFailure] NFT return failed for raffle ${raffleId}:`,
      result.error
    )
    return { nftReturnOk: false, nftReturnError: result.error }
  }
  return { nftReturnOk: true }
}

/**
 * If this raffle is past the extended end time, cannot draw (threshold / sales), and has used its one extension,
 * moves it to `failed_refund_available` (same as cron / raffle-page runner). Call before creator prize-return claim
 * so hosts are not stuck when status lagged behind real-world “ended”.
 */
export async function ensureMinThresholdTerminalBeforeCreatorPrizeReturn(
  raffleId: string
): Promise<Raffle | null> {
  let raffle = await getRaffleById(raffleId)
  if (!raffle) return null

  if (raffle.status === 'failed_refund_available' || raffle.status === 'cancelled') {
    return raffle
  }

  if (
    raffle.status !== 'live' &&
    raffle.status !== 'ready_to_draw' &&
    raffle.status !== 'pending_min_not_met'
  ) {
    return raffle
  }

  if (new Date(raffle.end_time) > new Date()) return raffle

  if ((raffle.winner_wallet ?? '').trim() || (raffle.winner_selected_at ?? '').trim()) {
    return raffle
  }

  if (!hasExhaustedMinThresholdTimeExtensions(raffle)) return raffle

  const entries = await getEntriesByRaffleId(raffleId)
  if (canSelectWinner(raffle, entries)) return raffle

  await finalizeMinThresholdTerminalFailure(raffleId)
  raffle = await getRaffleById(raffleId)
  return raffle
}
