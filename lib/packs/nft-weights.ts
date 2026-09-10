/**
 * Per-NFT inverse floor-price weights for pack opens.
 * Higher fair_value_sol → lower selection weight (ME-style rarity).
 */

import {
  PACK_NFT_FP_WEIGHT_ALPHA,
  PACK_NFT_MAX_FAIR_SOL,
  PACK_NFT_MIN_FAIR_SOL,
  PACK_NFT_WEIGHT_BASELINE_FAIR_SOL,
  isPackNftFairValueSol,
  type PackNftOddsTier,
} from '@/lib/packs/config'

export type NftPoolEntry = {
  id: string
  mint_address: string
  fair_value_sol: number
  name?: string | null
  image_url?: string | null
  odds_tier?: PackNftOddsTier
}

export type WeightedNftPoolEntry = NftPoolEntry & {
  weight: number
}

/**
 * Pool max FP for weight numerator: max(inventory highs, baseline 0.5 SOL).
 * Adding a grail NFT above 0.5 SOL rescales odds for the whole pool.
 */
export function resolveNftPoolMaxFairSol(fairValues: number[]): number {
  const poolMax = fairValues.length > 0 ? Math.max(...fairValues) : PACK_NFT_WEIGHT_BASELINE_FAIR_SOL
  return Math.max(PACK_NFT_WEIGHT_BASELINE_FAIR_SOL, poolMax)
}

/**
 * weight = round( (maxFp / fairValue)^alpha * 1000 ), floored at 1.
 * fairValue is not capped on the high side — expensive NFTs stay rarer.
 */
export function nftFpWeight(
  fairValueSol: number,
  options?: { alpha?: number; maxFp?: number; minFp?: number }
): number {
  const alpha = options?.alpha ?? PACK_NFT_FP_WEIGHT_ALPHA
  const maxFp = options?.maxFp ?? PACK_NFT_WEIGHT_BASELINE_FAIR_SOL
  const minFp = options?.minFp ?? PACK_NFT_MIN_FAIR_SOL
  if (!Number.isFinite(fairValueSol) || fairValueSol <= 0) return 1
  const clamped = Math.max(minFp, fairValueSol)
  const raw = Math.pow(maxFp / clamped, alpha) * 1000
  return Math.max(1, Math.round(raw))
}

export function buildWeightedNftPool(
  inventory: NftPoolEntry[],
  options?: { alpha?: number }
): WeightedNftPoolEntry[] {
  const eligible = inventory.filter(
    (row) =>
      Number.isFinite(row.fair_value_sol) && isPackNftFairValueSol(row.fair_value_sol)
  )
  const maxFp = resolveNftPoolMaxFairSol(eligible.map((row) => row.fair_value_sol))
  return eligible
    .map((row) => ({
      ...row,
      weight: nftFpWeight(row.fair_value_sol, { ...options, maxFp }),
    }))
    // Stable order for verify: mint ascending then id
    .sort((a, b) => {
      const m = a.mint_address.localeCompare(b.mint_address)
      return m !== 0 ? m : a.id.localeCompare(b.id)
    })
}

export function nftPoolSnapshotForStorage(pool: WeightedNftPoolEntry[]): {
  id: string
  mint: string
  fair_value_sol: number
  weight: number
  odds_tier: PackNftOddsTier
}[] {
  return pool.map((p) => ({
    id: p.id,
    mint: p.mint_address,
    fair_value_sol: p.fair_value_sol,
    weight: p.weight,
    odds_tier: p.odds_tier === 'premium_1pct' ? 'premium_1pct' : 'standard',
  }))
}

export type NftPoolSnapshotRow = {
  id: string
  mint: string
  fair_value_sol: number
  weight: number
  odds_tier?: PackNftOddsTier
}

export function poolFromSnapshot(snapshot: NftPoolSnapshotRow[]): WeightedNftPoolEntry[] {
  return snapshot.map((s) => ({
    id: s.id,
    mint_address: s.mint,
    fair_value_sol: s.fair_value_sol,
    weight: s.weight,
    odds_tier: s.odds_tier === 'premium_1pct' ? 'premium_1pct' : 'standard',
  }))
}

export function splitNftPoolByOddsTier(inventory: NftPoolEntry[]): {
  premium: NftPoolEntry[]
  standard: NftPoolEntry[]
} {
  const premium: NftPoolEntry[] = []
  const standard: NftPoolEntry[] = []
  for (const row of inventory) {
    if (row.odds_tier === 'premium_1pct') premium.push(row)
    else standard.push(row)
  }
  return { premium, standard }
}
