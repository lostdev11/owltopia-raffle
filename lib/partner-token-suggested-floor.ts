import type { RaffleCurrency } from '@/lib/types'
import { getPartnerPrizeMintForCurrency, isPartnerPrizeCurrency } from '@/lib/partner-prize-tokens'
import { getTokenInfo } from '@/lib/tokens'

export type PartnerPrizeCurrencyCode = 'SOL' | 'USDC' | 'TRQ'

function formatFloorInListingCurrency(value: number, listingCurrency: RaffleCurrency): string {
  if (listingCurrency === 'USDC') {
    return value >= 1 ? value.toFixed(2) : value >= 0.01 ? value.toFixed(4) : value.toFixed(6)
  }
  return value >= 1 ? value.toFixed(2) : value >= 0.01 ? value.toFixed(4) : value.toFixed(6)
}

/**
 * Suggested `floor_price` (advertised prize value) in listing / ticket currency from spot USD prices.
 * When prize and listing are the same asset (SOL↔wSOL, USDC↔USDC), returns exact `prizeAmountHuman`.
 */
export function computePartnerTokenSuggestedFloor(params: {
  prizeCurrency: PartnerPrizeCurrencyCode
  prizeAmountHuman: number
  listingCurrency: RaffleCurrency
  usdPerUnit: Record<string, number>
}): { floorPrice: string; listingCurrency: RaffleCurrency } | null {
  const { prizeCurrency, prizeAmountHuman, listingCurrency, usdPerUnit } = params
  if (!Number.isFinite(prizeAmountHuman) || prizeAmountHuman <= 0) return null
  if (!isPartnerPrizeCurrency(prizeCurrency)) return null

  const prizeMint = getPartnerPrizeMintForCurrency(prizeCurrency)
  if (!prizeMint) return null

  if (listingCurrency === prizeCurrency) {
    return {
      floorPrice: formatFloorInListingCurrency(prizeAmountHuman, listingCurrency),
      listingCurrency,
    }
  }

  const prizeUsd = usdPerUnit[prizeMint]
  if (!Number.isFinite(prizeUsd) || prizeUsd <= 0) return null

  const notionalUsd = prizeAmountHuman * prizeUsd

  if (listingCurrency === 'USDC') {
    return {
      floorPrice: formatFloorInListingCurrency(notionalUsd, 'USDC'),
      listingCurrency: 'USDC',
    }
  }

  const listingInfo = getTokenInfo(listingCurrency)
  const listingMint = listingInfo.mintAddress
  if (!listingMint) return null

  const listingUsd = usdPerUnit[listingMint]
  if (!Number.isFinite(listingUsd) || listingUsd <= 0) return null

  const inListing = notionalUsd / listingUsd
  if (!Number.isFinite(inListing) || inListing <= 0) return null

  return {
    floorPrice: formatFloorInListingCurrency(inListing, listingCurrency),
    listingCurrency,
  }
}
