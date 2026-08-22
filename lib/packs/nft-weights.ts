/**
 * Per-NFT inverse floor-price weights for pack opens.
 * Higher fair_value_sol → lower selection weight (ME-style rarity).
 */

import {
  PACK_NFT_FP_WEIGHT_ALPHA,
  PACK_NFT_MAX_FAIR_SOL,
  PACK_NFT_MIN_FAIR_SOL,
} from '@/lib/packs/config'

export type NftPoolEntry = {
  id: string
  mint_address: string
  fair_value_sol: number
  name?: string | null
  image_url?: string | null
}

export type WeightedNftPoolEntry = NftPoolEntry & {
  weight: number
}

/**
 * weight = round( (maxFp / fairValue)^alpha * 1000 ), floored at 1.
 * Clamps fair value into the allowed packs range before scoring.
 */
export function nftFpWeight(
  fairValueSol: number,
  options?: { alpha?: number; maxFp?: number; minFp?: number }
): number {
  const alpha = options?.alpha ?? PACK_NFT_FP_WEIGHT_ALPHA
  const maxFp = options?.maxFp ?? PACK_NFT_MAX_FAIR_SOL
  const minFp = options?.minFp ?? PACK_NFT_MIN_FAIR_SOL
  if (!Number.isFinite(fairValueSol) || fairValueSol <= 0) return 1
  const clamped = Math.min(maxFp, Math.max(minFp, fairValueSol))
  const raw = Math.pow(maxFp / clamped, alpha) * 1000
  return Math.max(1, Math.round(raw))
}

export function buildWeightedNftPool(
  inventory: NftPoolEntry[],
  options?: { alpha?: number }
): WeightedNftPoolEntry[] {
  return inventory
    .filter(
      (row) =>
        Number.isFinite(row.fair_value_sol) &&
        row.fair_value_sol >= PACK_NFT_MIN_FAIR_SOL &&
        row.fair_value_sol <= PACK_NFT_MAX_FAIR_SOL
    )
    .map((row) => ({
      ...row,
      weight: nftFpWeight(row.fair_value_sol, options),
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
}[] {
  return pool.map((p) => ({
    id: p.id,
    mint: p.mint_address,
    fair_value_sol: p.fair_value_sol,
    weight: p.weight,
  }))
}

export type NftPoolSnapshotRow = {
  id: string
  mint: string
  fair_value_sol: number
  weight: number
}

export function poolFromSnapshot(snapshot: NftPoolSnapshotRow[]): WeightedNftPoolEntry[] {
  return snapshot.map((s) => ({
    id: s.id,
    mint_address: s.mint,
    fair_value_sol: s.fair_value_sol,
    weight: s.weight,
  }))
}
