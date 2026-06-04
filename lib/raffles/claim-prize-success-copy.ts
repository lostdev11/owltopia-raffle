import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import type { Raffle } from '@/lib/types'

/** NFT giveaway / community giveaway claim success (dashboard). */
export const GIVEAWAY_NFT_CLAIM_SUCCESS_DETAIL =
  'Your NFT has been sent to your connected wallet. You can confirm the transfer on Solscan.'

/** User-facing copy for escrow prize claim success / loading overlays. */
export function getEscrowPrizeClaimSuccessCopy(
  raffle: Pick<Raffle, 'prize_type' | 'prize_currency'>
): {
  loadingDetail: string
  sentDetail: string
  alreadySentDetail: string
  prizeNoun: string
} {
  if (isPartnerSplPrizeRaffle(raffle)) {
    const ticker = (raffle.prize_currency ?? 'tokens').trim() || 'tokens'
    return {
      prizeNoun: `${ticker} prize`,
      loadingDetail:
        'Stay on this screen. Your wallet may ask you to sign in first; after that we broadcast the token transfer from escrow. Solana usually confirms within a few seconds.',
      sentDetail: `Your ${ticker} prize has been sent to your connected wallet. You can confirm the transfer on Solscan.`,
      alreadySentDetail:
        'This prize was already transferred to your wallet. Open Solscan below to verify the transaction.',
    }
  }
  return {
    prizeNoun: 'NFT prize',
    loadingDetail:
      'Stay on this screen. Your wallet may ask you to sign in first; after that we broadcast the NFT transfer from escrow. Solana usually confirms within a few seconds.',
    sentDetail:
      'Your NFT prize has been sent to your connected wallet. You can confirm the transfer on Solscan.',
    alreadySentDetail:
      'This prize was already transferred to your wallet. Open Solscan below to verify the transaction.',
  }
}
