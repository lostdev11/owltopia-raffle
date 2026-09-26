/**
 * Product-scoped prize shelves (0.1 SOL pack vs $OWL checkout).
 *
 * Main shelf: 30% OWL / 30% SOL / 40% NFT (Gembird 0.1 SOL pack).
 * $OWL shelf: 70% OWL / 0% SOL / 30% NFT — separate inventory + jackpot.
 */

import {
  isPackNftFairValueSol,
  PACK_CATEGORY_WEIGHTS_BPS,
  PACK_NFT_MAX_FAIR_SOL,
  PACK_NFT_MIN_FAIR_SOL,
  PACK_OWL_TIERS,
  PACK_PRICE_OWL,
  PACK_SOL_TIERS,
  PACKS_PRODUCT_SLUG,
  resolveOwlSolPrice,
  type PackOwlTier,
  type PackPaymentCurrency,
  type PackRegularCategory,
  type PackSolTier,
} from '@/lib/packs/config'

/** Main 0.1 SOL checkout shelf */
export const PACKS_PRODUCT_SLUG_MAIN = PACKS_PRODUCT_SLUG

/** $OWL checkout cheap shelf (separate inventory + jackpot) */
export const PACKS_PRODUCT_SLUG_OWL = 'owl-pack-owl-v1' as const

export function packProductSlugForPaymentCurrency(
  currency: PackPaymentCurrency
): typeof PACKS_PRODUCT_SLUG_MAIN | typeof PACKS_PRODUCT_SLUG_OWL {
  return currency === 'OWL' ? PACKS_PRODUCT_SLUG_OWL : PACKS_PRODUCT_SLUG_MAIN
}

export function isOwlCheckoutProductSlug(slug: string): boolean {
  return slug.trim() === PACKS_PRODUCT_SLUG_OWL
}

/** Category mix for $OWL checkout shelf (70 / 0 / 30). Main shelf uses PACK_CATEGORY_WEIGHTS_BPS. */
export const PACK_CATEGORY_WEIGHTS_BPS_OWL_SHELF: Record<PackRegularCategory, number> = {
  owl: 7000,
  sol: 0,
  nft: 3000,
}

export function resolvePackCategoryWeightsBps(
  productSlug: string | null | undefined
): Record<PackRegularCategory, number> {
  return isOwlCheckoutProductSlug(productSlug ?? '')
    ? PACK_CATEGORY_WEIGHTS_BPS_OWL_SHELF
    : PACK_CATEGORY_WEIGHTS_BPS
}

/** Minimum admin-tagged NFT floor on the $OWL cheap shelf (main shelf stays 0.05). */
export const PACK_NFT_MIN_FAIR_SOL_OWL_SHELF = 0.01

export function packNftMinFairSolForProductSlug(slug: string | null | undefined): number {
  return isOwlCheckoutProductSlug(slug ?? '')
    ? PACK_NFT_MIN_FAIR_SOL_OWL_SHELF
    : PACK_NFT_MIN_FAIR_SOL
}

export function isPackNftFairValueForProduct(
  value: number,
  productSlug: string | null | undefined
): boolean {
  return isPackNftFairValueSol(value, packNftMinFairSolForProductSlug(productSlug))
}

export function packNftFairValueRangeLabel(productSlug: string | null | undefined): string {
  const min = packNftMinFairSolForProductSlug(productSlug)
  return `${min}–${PACK_NFT_MAX_FAIR_SOL} SOL`
}

/**
 * $OWL shelf OWL ladder (10 → 50 OWL). Bottom-heavy within the OWL category.
 * No SOL cash tiers on this shelf.
 */
export const PACK_OWL_CHECKOUT_OWL_TIERS: PackOwlTier[] = [
  { category: 'owl', amount: 10, weight: 980, fairValueSol: 0.1 },
  { category: 'owl', amount: 20, weight: 10, fairValueSol: 0.2 },
  { category: 'owl', amount: 30, weight: 5, fairValueSol: 0.3 },
  { category: 'owl', amount: 40, weight: 3, fairValueSol: 0.4 },
  { category: 'owl', amount: 50, weight: 2, fairValueSol: 0.5 },
]

/** $OWL shelf has no SOL cash prizes (category weight 0). */
export const PACK_OWL_CHECKOUT_SOL_TIERS: PackSolTier[] = []

export type PackCashLadders = {
  owlTiers: PackOwlTier[]
  solTiers: PackSolTier[]
}

export function resolvePackCashLadders(
  productSlug: string,
  owlSolPrice?: number | null
): PackCashLadders {
  const rate = resolveOwlSolPrice(owlSolPrice)
  if (isOwlCheckoutProductSlug(productSlug)) {
    return {
      owlTiers: PACK_OWL_CHECKOUT_OWL_TIERS.map((t) => ({
        ...t,
        fairValueSol: t.amount * rate,
      })),
      solTiers: PACK_OWL_CHECKOUT_SOL_TIERS,
    }
  }
  return {
    owlTiers: PACK_OWL_TIERS.map((t) => ({
      ...t,
      fairValueSol: t.amount * rate,
    })),
    solTiers: PACK_SOL_TIERS,
  }
}

/** SOL-equivalent ticket price for $OWL checkout (OWL paid + SOL fee leg). */
export function packOwlCheckoutTicketSolEquiv(options: {
  owlSolPrice?: number | null
  paymentFeeSol?: number | null
  paymentOwlAmount?: number | null
}): number {
  const rate = resolveOwlSolPrice(options.owlSolPrice)
  const owlAmount =
    options.paymentOwlAmount != null && options.paymentOwlAmount > 0
      ? options.paymentOwlAmount
      : PACK_PRICE_OWL
  const fee =
    options.paymentFeeSol != null && options.paymentFeeSol >= 0
      ? options.paymentFeeSol
      : 0
  const raw = owlAmount * rate + fee
  return Math.round(raw * 1_000_000_000) / 1_000_000_000
}
