/**
 * ME-style percentage odds helpers for pack prize display.
 */

import {
  PACK_OWL_TIERS,
  owlTiersWithPrice,
  type PackPaymentCurrency,
  type PackRegularCategory,
} from '@/lib/packs/config'
import {
  owlTiersForProfile,
  resolvePackOddsProfile,
  type PackOddsProfile,
} from '@/lib/packs/odds-profiles'
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
      /**
       * True chance this exact mint is won (share of the shared chase pool).
       * With many chase NFTs this is often ≪ 1% — UI should prefer `tierPercentOverall`.
       */
      percentOverall: number
      /** Chase-tier rate shown to buyers (always the shared pool %, e.g. 1%). */
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
  paymentCurrency?: PackPaymentCurrency
  profile?: PackOddsProfile
}): PackOddsPercentages {
  const profile =
    options?.profile ??
    resolvePackOddsProfile(options?.paymentCurrency === 'OWL' ? 'OWL' : 'SOL')
  const weights = profile.categoryWeightsBps
  const catTotal = weights.owl + weights.sol + weights.nft

  const categories: PackOddsPercentages['categories'] = (
    ['owl', 'sol', 'nft'] as PackRegularCategory[]
  ).map((category) => ({
    category,
    weightBps: weights[category],
    percent: pct(weights[category], catTotal),
  }))

  const owlTiersSrc =
    profile.id === 'sol'
      ? owlTiersWithPrice(options?.owlSolPrice)
      : owlTiersForProfile(profile, options?.owlSolPrice)
  const owlSum = sumWeights(owlTiersSrc.map((t) => t.weight))
  const owlCatPct = weights.owl / catTotal
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

  const solSum = sumWeights(profile.solTiers.map((t) => t.weight))
  const solCatPct = weights.sol / catTotal
  const solTiers = profile.solTiers.map((t) => {
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
  const premiumOverallPct = profile.premiumNftOverallBps / 100
  const premiumItems = premiumPool.map((p) => {
    const ofPrem = pct(p.weight, premiumSum)
    return {
      mint: p.mint_address,
      name: p.name ?? null,
      fairValueSol: p.fair_value_sol,
      weight: p.weight,
      percentOfPremiumPool: ofPrem,
      // ofPrem is % of premium pool; overall = share * 1% overall
      percentOverall: Math.round((ofPrem * profile.premiumNftOverallBps) / 100) / 100,
      // Buyers see the chase *tier* rate (shared ~1%), not the diluted per-mint share.
      tierPercentOverall: premiumOverallPct,
    }
  })

  const nftCatPct = weights.nft / catTotal
  const standardShare =
    premiumPool.length > 0
      ? Math.max(0, nftCatPct - profile.premiumNftOverallBps / 10_000)
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
      overallBps: profile.premiumNftOverallBps,
      items: premiumItems,
    },
    nftInventory,
  }
}
