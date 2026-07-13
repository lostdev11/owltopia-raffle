import { getPrizeEscrowPublicKey } from '@/lib/raffles/prize-escrow'
import {
  checkEscrowHoldsNft,
  payoutSplLegacyWithCoreCompressedFallback,
} from '@/lib/raffles/prize-escrow'

export function getDiscordMarketplaceNftEscrowAddress(): string | null {
  return getPrizeEscrowPublicKey()
}

export async function verifyNftDepositedInMarketplaceEscrow(nftMint: string): Promise<{
  ok: boolean
  error?: string
}> {
  const hold = await checkEscrowHoldsNft({
    prize_type: 'nft',
    nft_mint_address: nftMint.trim(),
    nft_token_id: nftMint.trim(),
    prize_standard: null,
  })
  if (!hold.holds) {
    return {
      ok: false,
      error:
        hold.error ??
        'NFT not found in marketplace escrow. Transfer it to the escrow wallet first, then verify.',
    }
  }
  return { ok: true }
}

export async function fulfillMarketplaceNftToBuyer(params: {
  nftMint: string
  recipientWallet: string
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const result = await payoutSplLegacyWithCoreCompressedFallback(
    {
      nft_mint_address: params.nftMint.trim(),
      nft_token_id: params.nftMint.trim(),
    },
    params.recipientWallet.trim()
  )
  if (result.ok && result.signature) {
    return { ok: true, signature: result.signature }
  }
  return { ok: false, error: result.error ?? 'NFT transfer failed' }
}
