/**
 * Product-scoped prize shelves (0.1 SOL pack vs $OWL checkout).
 *
 * Same category hit-rate % and tier weight shape on both products; shelves differ
 * by which NFTs are deposited and (for $OWL product) smaller cash ladder amounts.
 */

import {
  PACK_OWL_TIERS,
  PACK_PRICE_OWL,
  PACK_SOL_TIERS,
  PACKS_PRODUCT_SLUG,
  resolveOwlSolPrice,
  type PackOwlTier,
  type PackPaymentCurrency,
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

/**
 * Cash ladders for $OWL product: same tier weights as production, smaller amounts (~$1 ticket EV).
 * Main SOL product uses constants in config.ts unchanged.
 */
export const PACK_OWL_CHECKOUT_OWL_TIERS: PackOwlTier[] = [
  { category: 'owl', amount: 2, weight: 980, fairValueSol: 0.02 },
  { category: 'owl', amount: 5, weight: 15, fairValueSol: 0.05 },
  { category: 'owl', amount: 10, weight: 5, fairValueSol: 0.1 },
]

/** Same weight shape as PACK_SOL_TIERS (60/10/10/10/5/3/2), capped at 0.1 SOL top tier. */
export const PACK_OWL_CHECKOUT_SOL_TIERS: PackSolTier[] = [
  { category: 'sol', amountSol: 0.01, weight: 60 },
  { category: 'sol', amountSol: 0.02, weight: 10 },
  { category: 'sol', amountSol: 0.03, weight: 10 },
  { category: 'sol', amountSol: 0.05, weight: 10 },
  { category: 'sol', amountSol: 0.07, weight: 5 },
  { category: 'sol', amountSol: 0.08, weight: 3 },
  { category: 'sol', amountSol: 0.1, weight: 2 },
]

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
