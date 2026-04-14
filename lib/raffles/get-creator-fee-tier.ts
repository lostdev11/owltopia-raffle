import { ownsOwltopia } from '@/lib/platform-fees'
import { HOLDER_FEE_BPS, PARTNER_COMMUNITY_FEE_BPS, STANDARD_FEE_BPS } from '@/lib/config/raffles'
import { getActivePartnerCommunityWalletSet } from '@/lib/raffles/partner-communities'

export type GetCreatorFeeTierOptions = {
  /** When true, always verify holder status (skip cache). Use for dashboard and when creating/updating a raffle. */
  skipCache?: boolean
  /**
   * Raffles list only: use quick DAS `searchAssets` only; skip the heavy per-wallet scan.
   * Avoids serverless timeouts when many unique creators are on the page.
   */
  listDisplayOnly?: boolean
}

/**
 * Fee tier for the raffle creator: 2% partner allowlist, else 3% Owl holder / 6% standard.
 * Used to deduct the platform fee from every ticket sale (split at purchase and at settlement).
 */
export async function getCreatorFeeTier(
  walletAddress: string,
  options?: GetCreatorFeeTierOptions
): Promise<{
  feeBps: number
  reason: 'holder' | 'standard' | 'partner_community'
}> {
  const normalized = walletAddress.trim()
  if (!normalized) {
    return {
      feeBps: STANDARD_FEE_BPS,
      reason: 'standard',
    }
  }

  const partners = await getActivePartnerCommunityWalletSet()
  if (partners.has(normalized)) {
    return {
      feeBps: PARTNER_COMMUNITY_FEE_BPS,
      reason: 'partner_community',
    }
  }

  const deepWalletScan =
    options?.skipCache === true &&
    options?.listDisplayOnly !== true

  const isHolder = await ownsOwltopia(normalized, {
    skipCache: options?.skipCache,
    listMode: options?.listDisplayOnly,
    deepWalletScan,
  })
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

