/**
 * ME-style percentage odds helpers for pack prize display.
 */

import {
  PACK_CATEGORY_WEIGHTS_BPS,
  PACK_OWL_TIERS,
  PACK_SOL_TIERS,
  owlTiersWithPrice,
  type PackPrizeCategory,
} from '@/lib/packs/config'
import { buildWeightedNftPool, type NftPoolEntry } from '@/lib/packs/nft-weights'

function sumWeights(weights: number[]): number {
  return weights.reduce((a, b) => a + b, 0)
}

function pct(part: number, whole: number): number {
  if (!(whole > 0)) return 0
  return Math.round((part / whole) * 10_000) / 100
}

export type PackOddsPercentages = {
  categories: { category: PackPrizeCategory; weightBps: number; percent: number }[]
  owlTiers: { amount: number; weight: number; percentOfCategory: number; percentOverall: number }[]
  solTiers: {
    amountSol: number
    weight: number
    percentOfCategory: number
    percentOverall: number
  }[]
  nftInventory: {
    mint: string
    name: string | null
    fairValueSol: number
    weight: number
    percentOfCategory: number
    percentOverall: number
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
    ['owl', 'sol', 'nft'] as PackPrizeCategory[]
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

  const pool = buildWeightedNftPool(options?.nftInventory ?? [])
  const nftSum = sumWeights(pool.map((p) => p.weight))
  const nftCatPct = PACK_CATEGORY_WEIGHTS_BPS.nft / catTotal
  const nftInventory = pool.map((p) => {
    const ofCat = pct(p.weight, nftSum)
    return {
      mint: p.mint_address,
      name: p.name ?? null,
      fairValueSol: p.fair_value_sol,
      weight: p.weight,
      percentOfCategory: ofCat,
      percentOverall: Math.round(ofCat * nftCatPct * 100) / 100,
    }
  })

  return { categories, owlTiers, solTiers, nftInventory }
}
