import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'
import { raffleRequiresCancellationFee } from '@/lib/raffles/cancellation-fee-policy'
import { MAX_MIN_THRESHOLD_TIME_EXTENSIONS } from '@/lib/raffles/ticket-escrow-policy'

/** Rows from dashboard API / DB share these fields; keep loose so client `Raffle` aliases stay assignable. */
export type RaffleRowForCreatorPrizeReturn = {
  creator_wallet?: string | null
  created_by?: string | null
  status?: string | null
  start_time?: string | null
  end_time?: string | null
  /** Present on API rows; defaults to 0 in {@link hasExhaustedMinThresholdTimeExtensions} if missing. */
  time_extension_count?: number | null
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
function raffleEndTimeHasPassed(raffle: Pick<RaffleRowForCreatorPrizeReturn, 'end_time'>): boolean {
  const t = raffle.end_time?.trim()
  if (!t) return false
  const ms = new Date(t).getTime()
  if (Number.isNaN(ms)) return false
  return ms <= Date.now()
}

export function canCreatorClaimPrizeBackFromEscrow(
  raffle: RaffleRowForCreatorPrizeReturn,
  wallet: string
): boolean {
  const w = wallet.trim()
  if (!w) return false
  const creator = (raffle.creator_wallet || raffle.created_by || '').trim()
  if (!creator || !walletsEqualSolana(creator, w)) return false
  if (raffle.winner_wallet?.trim() || (raffle.winner_selected_at && String(raffle.winner_selected_at).trim())) {
    return false
  }
  if (!raffle.prize_deposited_at) return false
  if (raffle.prize_returned_at) return false
  if (raffle.nft_transfer_transaction?.trim()) return false
  if (isPartnerSplPrizeRaffle(raffle)) {
    // fall through to status gate below
  } else {
    const prizeAssetId =
      (raffle.nft_mint_address || '').trim() || (raffle.nft_token_id || '').trim()
    if (!(raffle.prize_type === 'nft' && !!prizeAssetId)) return false
  }

  const st = raffle.status ?? ''
  if (st === 'failed_refund_available' || st === 'cancelled') return true

  /** Matches server {@link ensureMinThresholdTerminalBeforeCreatorPrizeReturn}: show claim while status lags. */
  const extCount = raffle.time_extension_count ?? 0
  if (
    (st === 'live' || st === 'ready_to_draw' || st === 'pending_min_not_met') &&
    raffleEndTimeHasPassed(raffle) &&
    extCount >= MAX_MIN_THRESHOLD_TIME_EXTENSIONS
  ) {
    return true
  }

  return false
}
