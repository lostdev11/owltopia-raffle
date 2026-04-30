import type { Raffle } from '@/lib/types'
import { nftRaffleExemptFromEscrowRequirement } from '@/lib/raffles/visibility'
import { isOwlEnabled } from '@/lib/tokens'

/** Friendly block reason or null when purchase may proceed (subject to server/create). */
export function raffleCheckoutBlockedReason(raffle: Raffle): string | null {
  const purchasesBlockedAt = (raffle as { purchases_blocked_at?: string | null }).purchases_blocked_at
  if (purchasesBlockedAt) {
    return 'Purchases are temporarily blocked for this raffle.'
  }

  if (!raffle.is_active) return 'This raffle is not active.'

  if (new Date(raffle.end_time) <= new Date()) return 'This raffle has ended.'

  if (raffle.currency === 'OWL' && !isOwlEnabled()) {
    return 'OWL entry is not enabled yet — mint address pending.'
  }

  if (
    raffle.prize_type === 'nft' &&
    !raffle.prize_deposited_at &&
    !nftRaffleExemptFromEscrowRequirement(raffle)
  ) {
    return 'This NFT raffle is not ready for entries yet.'
  }

  return null
}
