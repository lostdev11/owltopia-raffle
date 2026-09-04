import {
  OWL_CENTER_PRESALE_LIMITS,
  OWL_CENTER_PRESALE_DEFAULT_MAX_CREDITS_PER_WALLET,
  OWL_CENTER_PRESALE_DEFAULT_MAX_SPOTS_PER_PURCHASE,
  OWL_CENTER_PRESALE_DEFAULT_PRICE_USDC,
  OWL_CENTER_PRESALE_DEFAULT_SUPPLY,
} from '@/lib/owl-center-presale/constants'

export function clampOwlCenterPresaleInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function parseOwlCenterPresaleSupply(raw: unknown, fallback = OWL_CENTER_PRESALE_DEFAULT_SUPPLY): number {
  return clampOwlCenterPresaleInt(
    raw,
    fallback,
    OWL_CENTER_PRESALE_LIMITS.supply.min,
    OWL_CENTER_PRESALE_LIMITS.supply.max
  )
}

export function parseOwlCenterPresalePriceUsdc(
  raw: unknown,
  fallback = OWL_CENTER_PRESALE_DEFAULT_PRICE_USDC
): number {
  return clampOwlCenterPresaleInt(
    raw,
    fallback,
    OWL_CENTER_PRESALE_LIMITS.priceUsdc.min,
    OWL_CENTER_PRESALE_LIMITS.priceUsdc.max
  )
}

export function parseOwlCenterPresaleMaxSpotsPerPurchase(
  raw: unknown,
  fallback = OWL_CENTER_PRESALE_DEFAULT_MAX_SPOTS_PER_PURCHASE
): number {
  return clampOwlCenterPresaleInt(
    raw,
    fallback,
    OWL_CENTER_PRESALE_LIMITS.maxSpotsPerPurchase.min,
    OWL_CENTER_PRESALE_LIMITS.maxSpotsPerPurchase.max
  )
}

export function parseOwlCenterPresaleMaxCreditsPerWallet(
  raw: unknown,
  fallback = OWL_CENTER_PRESALE_DEFAULT_MAX_CREDITS_PER_WALLET
): number {
  return clampOwlCenterPresaleInt(
    raw,
    fallback,
    OWL_CENTER_PRESALE_LIMITS.maxCreditsPerWallet.min,
    OWL_CENTER_PRESALE_LIMITS.maxCreditsPerWallet.max
  )
}

/** Ensure per-purchase cap never exceeds per-wallet cap. */
export function normalizeOwlCenterPresaleCaps(input: {
  max_spots_per_purchase: number
  max_credits_per_wallet: number
}): { max_spots_per_purchase: number; max_credits_per_wallet: number } {
  const max_credits_per_wallet = input.max_credits_per_wallet
  const max_spots_per_purchase = Math.min(input.max_spots_per_purchase, max_credits_per_wallet)
  return { max_spots_per_purchase, max_credits_per_wallet }
}
