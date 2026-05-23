import { getRaffleOfferWindowEndsAt, isRaffleOfferWindowOpen } from '@/lib/db/raffle-offers'
import type { Raffle, RaffleStatus } from '@/lib/types'

export type NonTerminalNftRaffleConflictRow = {
  slug: string
  status: RaffleStatus | null
  winner_selected_at?: string | null
  end_time?: string | null
  winner_wallet?: string | null
  nft_transfer_transaction?: string | null
  prize_returned_at?: string | null
}

export type DuplicateNftPrizeConflictReason =
  | 'active_listing'
  | 'post_draw_offers'
  | 'settlement_in_progress'

export type DuplicateNftPrizeConflictBody = {
  error: string
  existing_slug: string
  existing_status: RaffleStatus | null
  conflict_reason: DuplicateNftPrizeConflictReason
  offer_window_ends_at?: string | null
}

function asRaffleSlice(row: NonTerminalNftRaffleConflictRow): Pick<
  Raffle,
  | 'winner_selected_at'
  | 'end_time'
  | 'winner_wallet'
  | 'nft_transfer_transaction'
  | 'prize_returned_at'
> {
  return {
    winner_selected_at: row.winner_selected_at ?? null,
    end_time: row.end_time ?? '',
    winner_wallet: row.winner_wallet ?? null,
    nft_transfer_transaction: row.nft_transfer_transaction ?? null,
    prize_returned_at: row.prize_returned_at ?? null,
  }
}

/**
 * User-facing copy when the same NFT mint cannot be listed again yet.
 */
export function buildDuplicateNftPrizeConflictBody(
  row: NonTerminalNftRaffleConflictRow
): DuplicateNftPrizeConflictBody {
  const status = row.status
  const raffleSlice = asRaffleSlice(row)
  const offerEndsAt = getRaffleOfferWindowEndsAt(raffleSlice as Raffle)
  const offerWindowOpen = isRaffleOfferWindowOpen(raffleSlice as Raffle)

  if (status === 'successful_pending_claims') {
    if (offerWindowOpen && offerEndsAt) {
      return {
        error:
          'This NFT was used in a raffle that already ended. Buyout offers stay open for 24 hours after the winner is picked — you can create a new raffle for this NFT after that window closes and the prize leaves escrow.',
        existing_slug: row.slug,
        existing_status: status,
        conflict_reason: 'post_draw_offers',
        offer_window_ends_at: offerEndsAt.toISOString(),
      }
    }

    return {
      error:
        'This NFT’s previous raffle is still being settled (prize may still be in escrow). Open that raffle to finish claims, or wait until the winner claims the prize before listing this NFT again.',
      existing_slug: row.slug,
      existing_status: status,
      conflict_reason: 'settlement_in_progress',
      offer_window_ends_at: offerEndsAt?.toISOString() ?? null,
    }
  }

  return {
    error:
      'This NFT already has an active raffle listing. Open that listing or wait until it completes or is cancelled.',
    existing_slug: row.slug,
    existing_status: status,
    conflict_reason: 'active_listing',
    offer_window_ends_at: null,
  }
}
