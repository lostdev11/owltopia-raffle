import type { Raffle } from '@/lib/types'
import { nftRaffleExemptFromEscrowRequirement } from '@/lib/raffles/visibility'
import { isOwlEnabled } from '@/lib/tokens'
import { raffleAcceptsSolAndBambooTickets } from '@/lib/raffles/dual-ticket-payment'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

/** True when `wallet` is the raffle's creator (creators cannot buy their own tickets). */
export function isRaffleCreatorWallet(raffle: Raffle, wallet: string | null | undefined): boolean {
  const creator = (raffle.creator_wallet || raffle.created_by || '').trim()
  return !!wallet && !!creator && walletsEqualSolana(creator, wallet)
}

/** Friendly block reason or null when purchase may proceed (subject to server/create). */
export function raffleCheckoutBlockedReason(
  raffle: Raffle,
  viewerWallet?: string | null
): string | null {
  const purchasesBlockedAt = (raffle as { purchases_blocked_at?: string | null }).purchases_blocked_at
  if (purchasesBlockedAt) {
    return 'Purchases are temporarily blocked for this raffle.'
  }

  if (isRaffleCreatorWallet(raffle, viewerWallet)) {
    return 'You cannot buy tickets in your own raffle.'
  }

  if (!raffle.is_active) return 'This raffle is not active.'

  if (new Date(raffle.end_time) <= new Date()) return 'This raffle has ended.'

  if (raffleAcceptsSolAndBambooTickets(raffle)) {
    return 'This raffle accepts SOL or BAMBOO per ticket. Open the raffle page and tap Buy to choose your payment token — cart checkout is one currency per transaction.'
  }

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
