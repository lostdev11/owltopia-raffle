import type { NftGiveaway } from '@/lib/types'
import type { Raffle } from '@/lib/types'
import {
  payoutSplFromEscrowToRecipient,
  payoutMplCoreFromEscrowToRecipient,
  payoutCompressedFromEscrowToRecipient,
} from '@/lib/raffles/prize-escrow'

export function nftGiveawayToEscrowProbe(
  g: NftGiveaway
): Pick<Raffle, 'prize_type' | 'nft_mint_address' | 'nft_token_id' | 'prize_standard'> {
  return {
    prize_type: 'nft',
    nft_mint_address: g.nft_mint_address,
    nft_token_id: g.nft_token_id,
    prize_standard: g.prize_standard,
  }
}

/**
 * Send giveaway NFT from prize escrow to the eligible wallet (no DB updates).
 * Matches raffle claim routing: explicit standard first, then SPL with compressed fallback.
 */
export async function payoutNftGiveawayFromEscrow(g: NftGiveaway): Promise<{
  ok: boolean
  signature?: string
  error?: string
}> {
  const recipient = g.eligible_wallet.trim()
  if (g.prize_standard === 'mpl_core') {
    return payoutMplCoreFromEscrowToRecipient(g.nft_mint_address, recipient)
  }
  if (g.prize_standard === 'compressed') {
    const assetId = (g.nft_token_id || g.nft_mint_address || '').trim()
    if (!assetId) {
      return { ok: false, error: 'Missing compressed NFT asset id' }
    }
    return payoutCompressedFromEscrowToRecipient(assetId, recipient)
  }

  let result = await payoutSplFromEscrowToRecipient(g.nft_mint_address, recipient)
  if (
    !result.ok &&
    typeof result.error === 'string' &&
    result.error.includes('Escrow does not hold this NFT')
  ) {
    const assetId = (g.nft_token_id || g.nft_mint_address || '').trim()
    if (assetId) {
      result = await payoutCompressedFromEscrowToRecipient(assetId, recipient)
    }
  }
  return result
}
