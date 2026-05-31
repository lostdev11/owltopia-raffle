import type { Raffle, RaffleStatus } from '@/lib/types'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import { checkEscrowHoldsPartnerSplPrize } from '@/lib/raffles/prize-escrow'
import type { DuplicateNftPrizeConflictBody } from '@/lib/raffles/duplicate-nft-prize-conflict'

const NON_TERMINAL_PARTNER_CRYPTO_STATUSES: RaffleStatus[] = [
  'draft',
  'live',
  'ready_to_draw',
  'pending_min_not_met',
  'successful_pending_claims',
]

/**
 * Whether creating another partner-token (e.g. SOL) prize raffle should be blocked.
 * After draw, allow a new listing once the prize left escrow (winner claim or return).
 */
export async function shouldBlockPartnerCryptoDuplicateCreate(raffle: Raffle): Promise<boolean> {
  if (!isPartnerSplPrizeRaffle(raffle)) return false
  const status = raffle.status
  if (!status || !NON_TERMINAL_PARTNER_CRYPTO_STATUSES.includes(status)) return false

  if (status === 'successful_pending_claims') {
    if (raffle.prize_returned_at) return false
    if ((raffle.nft_transfer_transaction ?? '').trim()) return false
    const { holds } = await checkEscrowHoldsPartnerSplPrize(raffle)
    return holds
  }

  return true
}

export function buildDuplicatePartnerCryptoPrizeConflictBody(
  raffle: Raffle
): DuplicateNftPrizeConflictBody {
  const status = raffle.status
  const cur = (raffle.prize_currency || 'token').trim().toUpperCase()

  if (status === 'successful_pending_claims') {
    if (raffle.creator_claimed_at) {
      return {
        error: `Your previous ${cur} prize raffle has ended and you already claimed ticket proceeds. The ${cur} prize is still in escrow until the winner claims it — you can start another ${cur} prize raffle after the winner claims (or the prize is returned to you).`,
        existing_slug: raffle.slug,
        existing_status: status,
        conflict_reason: 'settlement_in_progress',
        offer_window_ends_at: null,
      }
    }

    return {
      error: `Your previous ${cur} prize raffle is still settling after the draw. Open that raffle to finish claims before listing the same prize token again.`,
      existing_slug: raffle.slug,
      existing_status: status,
      conflict_reason: 'settlement_in_progress',
      offer_window_ends_at: null,
    }
  }

  return {
    error: `You already have an active ${cur} prize raffle. Finish or cancel it before starting another with the same prize token.`,
    existing_slug: raffle.slug,
    existing_status: status,
    conflict_reason: 'active_listing',
    offer_window_ends_at: null,
  }
}
