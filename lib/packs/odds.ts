/**
 * ME-style percentage odds helpers for pack prize display.
 */

import {
  PACK_OWL_TIERS,
  PACK_PREMIUM_NFT_OVERALL_BPS,
  PACK_SOL_TIERS,
  PACKS_PRODUCT_SLUG,
  type PackRegularCategory,
} from '@/lib/packs/config'
import {
  packNftMinFairSolForProductSlug,
  resolvePackCashLadders,
  resolvePackCategoryWeightsBps,
} from '@/lib/packs/product-pools'
import {
  buildWeightedNftPool,
  splitNftPoolByOddsTier,
  type NftPoolEntry,
} from '@/lib/packs/nft-weights'

function sumWeights(weights: number[]): number {
  return weights.reduce((a, b) => a + b, 0)
}

function pct(part: number, whole: number): number {
  if (!(whole > 0)) return 0
  return Math.round((part / whole) * 10_000) / 100
}

export type PackOddsPercentages = {
  categories: { category: PackRegularCategory; weightBps: number; percent: number }[]
  owlTiers: { amount: number; weight: number; percentOfCategory: number; percentOverall: number }[]
  solTiers: {
    amountSol: number
    weight: number
    percentOfCategory: number
    percentOverall: number
  }[]
  /** Shared ~1% overall chase pool (admin odds_tier = premium_1pct). */
  premiumNft: {
    overallPercent: number
    overallBps: number
    items: {
      mint: string
      name: string | null
      fairValueSol: number
      weight: number
      percentOfPremiumPool: number
      percentOverall: number
      tierPercentOverall: number
    }[]
  }
  nftInventory: {
    mint: string
    name: string | null
    fairValueSol: number
    weight: number
    percentOfCategory: number
    percentOverall: number
    oddsTier: 'standard' | 'premium_1pct'
  }[]
}

export function computePackOddsPercentages(options?: {
  owlSolPrice?: number | null
  nftInventory?: NftPoolEntry[]
  /** Product shelf slug — category mix + cash tier amounts. */
  productSlug?: string
}): PackOddsPercentages {
  const categoryWeights = resolvePackCategoryWeightsBps(
    options?.productSlug ?? PACKS_PRODUCT_SLUG
  )
  const catTotal =
    categoryWeights.owl + categoryWeights.sol + categoryWeights.nft

  const categories: PackOddsPercentages['categories'] = (
    ['owl', 'sol', 'nft'] as PackRegularCategory[]
  ).map((category) => ({
    category,
    weightBps: categoryWeights[category],
    percent: pct(categoryWeights[category], catTotal),
  }))

  const ladders = resolvePackCashLadders(
    options?.productSlug ?? PACKS_PRODUCT_SLUG,
    options?.owlSolPrice
  )
  const owlTiersSrc = ladders.owlTiers
  const owlSum = sumWeights(owlTiersSrc.map((t) => t.weight))
  const owlCatPct = categoryWeights.owl / catTotal
  const owlTiers = owlTiersSrc.map((t) => {
    const ofCat = pct(t.weight, owlSum)
    return {
      amount: t.amount,
      weight: t.weight,
      percentOfCategory: ofCat,
      percentOverall: Math.round(ofCat * owlCatPct * 100) / 100,
    }
  })

  void PACK_OWL_TIERS

  const solSum = sumWeights(ladders.solTiers.map((t) => t.weight))
  const solCatPct = categoryWeights.sol / catTotal
  const solTiers = ladders.solTiers.map((t) => {
    const ofCat = pct(t.weight, solSum)
    return {
      amountSol: t.amountSol,
      weight: t.weight,
      percentOfCategory: ofCat,
      percentOverall: Math.round(ofCat * solCatPct * 100) / 100,
    }
  })

  void PACK_SOL_TIERS

  const inventory = options?.nftInventory ?? []
  const minFairSol = packNftMinFairSolForProductSlug(options?.productSlug)
  const { premium, standard } = splitNftPoolByOddsTier(inventory)
  const premiumPool = buildWeightedNftPool(premium, { minFairSol })
  const premiumSum = sumWeights(premiumPool.map((p) => p.weight))
  const premiumOverallPct = PACK_PREMIUM_NFT_OVERALL_BPS / 100
  const premiumItems = premiumPool.map((p) => {
    const ofPrem = pct(p.weight, premiumSum)
    return {
      mint: p.mint_address,
      name: p.name ?? null,
      fairValueSol: p.fair_value_sol,
      weight: p.weight,
      percentOfPremiumPool: ofPrem,
      percentOverall: Math.round((ofPrem * PACK_PREMIUM_NFT_OVERALL_BPS) / 100) / 100,
      tierPercentOverall: premiumOverallPct,
    }
  })

  const nftCatPct = categoryWeights.nft / catTotal
  const standardShare =
    premiumPool.length > 0
      ? Math.max(0, nftCatPct - PACK_PREMIUM_NFT_OVERALL_BPS / 10_000)
      : nftCatPct
  const standardPool = buildWeightedNftPool(standard.length > 0 ? standard : inventory, {
    minFairSol,
  })
  const nftSum = sumWeights(standardPool.map((p) => p.weight))
  const nftInventory = standardPool.map((p) => {
    const ofCat = pct(p.weight, nftSum)
    return {
      mint: p.mint_address,
      name: p.name ?? null,
      fairValueSol: p.fair_value_sol,
      weight: p.weight,
      percentOfCategory: ofCat,
      percentOverall: Math.round(ofCat * standardShare * 100) / 100,
      oddsTier: (p.odds_tier === 'premium_1pct' ? 'premium_1pct' : 'standard') as
        | 'standard'
        | 'premium_1pct',
    }
  })

  return {
    categories,
    owlTiers,
    solTiers,
    premiumNft: {
      overallPercent: premiumOverallPct,
      overallBps: PACK_PREMIUM_NFT_OVERALL_BPS,
      items: premiumItems,
    },
    nftInventory,
  }
}
