import { ownsOwltopia } from '@/lib/platform-fees'
import { HOLDER_FEE_BPS, STANDARD_FEE_BPS } from '@/lib/config/raffles'

/**
 * Fee tier for the raffle creator: 3% if they hold Owltopia (Owl) NFT, 6% otherwise.
 * Used to deduct the platform fee from every ticket sale (split at purchase and at settlement).
 */
export async function getCreatorFeeTier(walletAddress: string): Promise<{
  feeBps: number
  reason: 'holder' | 'standard'
}> {
  const normalized = walletAddress.trim()
  if (!normalized) {
    return {
      feeBps: STANDARD_FEE_BPS,
      reason: 'standard',
    }
  }

  const isHolder = await ownsOwltopia(normalized)
  if (isHolder) {
    return {
      feeBps: HOLDER_FEE_BPS,
      reason: 'holder',
    }
  }

  return {
    feeBps: STANDARD_FEE_BPS,
    reason: 'standard',
  }
}

