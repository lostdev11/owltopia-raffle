import type { CommunityGiveaway, NftGiveaway } from '@/lib/types'
import type { Raffle } from '@/lib/types'
import {
  payoutSplFromEscrowToRecipient,
  payoutMplCoreFromEscrowToRecipient,
  payoutCompressedFromEscrowToRecipient,
} from '@/lib/raffles/prize-escrow'

/** Fields needed to resolve escrow custody + payout route (mint is always set for giveaways). */
export type NftEscrowPayoutProbe = Pick<
  Raffle,
  'prize_type' | 'nft_mint_address' | 'nft_token_id' | 'prize_standard'
> & { nft_mint_address: string }

export function nftGiveawayToEscrowProbe(g: NftGiveaway): NftEscrowPayoutProbe {
  return {
    prize_type: 'nft',
    nft_mint_address: g.nft_mint_address,
    nft_token_id: g.nft_token_id,
    prize_standard: g.prize_standard,
  }
}

export function communityGiveawayToEscrowProbe(
  g: Pick<CommunityGiveaway, 'nft_mint_address' | 'nft_token_id' | 'prize_standard'>
): NftEscrowPayoutProbe {
  return {
    prize_type: 'nft',
    nft_mint_address: g.nft_mint_address,
    nft_token_id: g.nft_token_id,
    prize_standard: g.prize_standard,
  }
}

/**
 * Send NFT from prize escrow to recipient (no DB updates).
 * Matches raffle claim routing: explicit standard first, then SPL with compressed fallback.
 */
export async function payoutNftPrizeFromEscrowToRecipient(
  probe: NftEscrowPayoutProbe,
  recipientWallet: string
): Promise<{
  ok: boolean
  signature?: string
  error?: string
}> {
  const recipient = recipientWallet.trim()
  if (probe.prize_standard === 'mpl_core') {
    return payoutMplCoreFromEscrowToRecipient(probe.nft_mint_address, recipient)
  }
  if (probe.prize_standard === 'compressed') {
    const assetId = (probe.nft_token_id || probe.nft_mint_address || '').trim()
    if (!assetId) {
      return { ok: false, error: 'Missing compressed NFT asset id' }
    }
    return payoutCompressedFromEscrowToRecipient(assetId, recipient)
  }

  let result = await payoutSplFromEscrowToRecipient(probe.nft_mint_address, recipient)
  if (
    !result.ok &&
    typeof result.error === 'string' &&
    result.error.includes('Escrow does not hold this NFT')
  ) {
    const assetId = (probe.nft_token_id || probe.nft_mint_address || '').trim()
    if (assetId) {
      result = await payoutCompressedFromEscrowToRecipient(assetId, recipient)
    }
  }
  return result
}

/**
 * Send giveaway NFT from prize escrow to the eligible wallet (no DB updates).
 */
export async function payoutNftGiveawayFromEscrow(g: NftGiveaway): Promise<{
  ok: boolean
  signature?: string
  error?: string
}> {
  return payoutNftPrizeFromEscrowToRecipient(nftGiveawayToEscrowProbe(g), g.eligible_wallet)
}
