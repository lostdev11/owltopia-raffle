import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'
import { raffleRequiresCancellationFee } from '@/lib/raffles/cancellation-fee-policy'

/** Rows from dashboard API / DB share these fields; keep loose so client `Raffle` aliases stay assignable. */
export type RaffleRowForCreatorPrizeReturn = {
  creator_wallet?: string | null
  created_by?: string | null
  status?: string | null
  start_time?: string | null
  cancellation_fee_paid_at?: string | null
  winner_wallet?: string | null
  winner_selected_at?: string | null
  prize_deposited_at?: string | null
  prize_returned_at?: string | null
  nft_transfer_transaction?: string | null
  prize_type?: string | null
  nft_mint_address?: string | null
  nft_token_id?: string | null
  prize_currency?: string | null
}

/** Cancelled-after-start: pay SOL cancellation fee before creator can pull prize from escrow (matches dashboard / claim API). */
export function needsPayCancellationFeeBeforePrizeReturn(
  raffle: Pick<RaffleRowForCreatorPrizeReturn, 'status' | 'start_time' | 'cancellation_fee_paid_at'>
): boolean {
  if (raffle.status !== 'cancelled') return false
  const start = raffle.start_time?.trim()
  if (!start) return false
  if (!raffleRequiresCancellationFee({ start_time: start }, new Date())) return false
  return !raffle.cancellation_fee_paid_at
}

/**
 * Creator can call POST /api/raffles/[id]/claim-failed-min-prize-return when min threshold failed (terminal)
 * or listing was cancelled — same rules as dashboard “Claim NFT / tokens from escrow”.
 */
export function canCreatorClaimPrizeBackFromEscrow(
  raffle: RaffleRowForCreatorPrizeReturn,
  wallet: string
): boolean {
  const w = wallet.trim()
  if (!w) return false
  const creator = (raffle.creator_wallet || raffle.created_by || '').trim()
  if (!creator || !walletsEqualSolana(creator, w)) return false
  if (raffle.status !== 'failed_refund_available' && raffle.status !== 'cancelled') return false
  if (raffle.winner_wallet?.trim() || (raffle.winner_selected_at && String(raffle.winner_selected_at).trim())) {
    return false
  }
  if (!raffle.prize_deposited_at) return false
  if (raffle.prize_returned_at) return false
  if (raffle.nft_transfer_transaction?.trim()) return false
  if (isPartnerSplPrizeRaffle(raffle)) return true
  const prizeAssetId =
    (raffle.nft_mint_address || '').trim() || (raffle.nft_token_id || '').trim()
  return raffle.prize_type === 'nft' && !!prizeAssetId
}
