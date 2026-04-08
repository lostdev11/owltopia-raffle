import { ownsOwltopia } from '@/lib/platform-fees'
import { HOLDER_FEE_BPS, STANDARD_FEE_BPS } from '@/lib/config/raffles'

export type GetCreatorFeeTierOptions = {
  /** When true, always verify holder status (skip cache). Use for dashboard and when creating/updating a raffle. */
  skipCache?: boolean
}

/**
 * Fee tier for the raffle creator: 3% for Owltopia Holders, 6% otherwise.
 * Used to deduct the platform fee from every ticket sale (split at purchase and at settlement).
 */
export async function getCreatorFeeTier(
  walletAddress: string,
  options?: GetCreatorFeeTierOptions
): Promise<{
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

  const isHolder = await ownsOwltopia(normalized, { skipCache: options?.skipCache })
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

