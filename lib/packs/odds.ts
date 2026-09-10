/**
 * ME-style percentage odds helpers for pack prize display.
 */

import {
  PACK_CATEGORY_WEIGHTS_BPS,
  PACK_OWL_TIERS,
  PACK_PREMIUM_NFT_OVERALL_BPS,
  PACK_SOL_TIERS,
  owlTiersWithPrice,
  type PackRegularCategory,
} from '@/lib/packs/config'
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
}): PackOddsPercentages {
  const catTotal =
    PACK_CATEGORY_WEIGHTS_BPS.owl +
    PACK_CATEGORY_WEIGHTS_BPS.sol +
    PACK_CATEGORY_WEIGHTS_BPS.nft

  const categories: PackOddsPercentages['categories'] = (
    ['owl', 'sol', 'nft'] as PackRegularCategory[]
  ).map((category) => ({
    category,
    weightBps: PACK_CATEGORY_WEIGHTS_BPS[category],
    percent: pct(PACK_CATEGORY_WEIGHTS_BPS[category], catTotal),
  }))

  const owlTiersSrc = owlTiersWithPrice(options?.owlSolPrice)
  const owlSum = sumWeights(owlTiersSrc.map((t) => t.weight))
  const owlCatPct = PACK_CATEGORY_WEIGHTS_BPS.owl / catTotal
  const owlTiers = owlTiersSrc.map((t) => {
    const ofCat = pct(t.weight, owlSum)
    return {
      amount: t.amount,
      weight: t.weight,
      percentOfCategory: ofCat,
      percentOverall: Math.round(ofCat * owlCatPct * 100) / 100,
    }
  })

  // PACK_OWL_TIERS kept referenced so tree-shaking does not drop ladder exports used by docs/UI.
  void PACK_OWL_TIERS

  const solSum = sumWeights(PACK_SOL_TIERS.map((t) => t.weight))
  const solCatPct = PACK_CATEGORY_WEIGHTS_BPS.sol / catTotal
  const solTiers = PACK_SOL_TIERS.map((t) => {
    const ofCat = pct(t.weight, solSum)
    return {
      amountSol: t.amountSol,
      weight: t.weight,
      percentOfCategory: ofCat,
      percentOverall: Math.round(ofCat * solCatPct * 100) / 100,
    }
  })

  const inventory = options?.nftInventory ?? []
  const { premium, standard } = splitNftPoolByOddsTier(inventory)
  const premiumPool = buildWeightedNftPool(premium)
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
      // ofPrem is % of premium pool; overall = share * 1% overall
      percentOverall: Math.round((ofPrem * PACK_PREMIUM_NFT_OVERALL_BPS) / 100) / 100,
    }
  })

  const nftCatPct = PACK_CATEGORY_WEIGHTS_BPS.nft / catTotal
  const standardShare =
    premiumPool.length > 0
      ? Math.max(0, nftCatPct - PACK_PREMIUM_NFT_OVERALL_BPS / 10_000)
      : nftCatPct
  const standardPool = buildWeightedNftPool(standard.length > 0 ? standard : inventory)
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
