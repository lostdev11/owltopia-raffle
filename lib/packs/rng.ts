import { createHash } from 'node:crypto'
import {
  PACK_CATEGORY_WEIGHTS_BPS,
  PACK_NFT_VALUE_BANDS,
  PACK_OWL_TIERS,
  PACK_SOL_TIERS,
  owlTiersWithPrice,
  type PackPrizeCategory,
} from '@/lib/packs/config'
import type { WeightedTierPick } from '@/lib/packs/types'
import { generateDrawSeed, hashDrawCommit } from '@/lib/raffles/draw/rng'

export { generateDrawSeed as generatePackOpenSeed, hashDrawCommit as hashPackOpenCommit }

/** Big-endian uint from first 8 bytes of SHA-256, then mod m. */
export function hashMod(seed: string, domain: string, modulus: number): number {
  if (!Number.isInteger(modulus) || modulus <= 0) {
    throw new Error('modulus must be a positive integer')
  }
  const digest = createHash('sha256').update(`${seed.trim()}:${domain}:${modulus}`, 'utf8').digest()
  let n = 0n
  for (let i = 0; i < 8; i++) {
    n = (n << 8n) | BigInt(digest[i]!)
  }
  return Number(n % BigInt(modulus))
}

function pickWeightedIndex(seed: string, domain: string, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) throw new Error('weights must sum to a positive value')
  let ticket = hashMod(seed, domain, total)
  for (let i = 0; i < weights.length; i++) {
    ticket -= weights[i]!
    if (ticket < 0) return i
  }
  return weights.length - 1
}

export function pickCategory(seed: string): PackPrizeCategory {
  const entries: PackPrizeCategory[] = ['owl', 'sol', 'nft']
  const weights = entries.map((c) => PACK_CATEGORY_WEIGHTS_BPS[c])
  const idx = pickWeightedIndex(seed, 'category', weights)
  return entries[idx]!
}

export function pickTier(
  seed: string,
  category: PackPrizeCategory,
  owlSolPrice?: number | null
): WeightedTierPick {
  if (category === 'owl') {
    const tiers = owlTiersWithPrice(owlSolPrice)
    const idx = pickWeightedIndex(
      seed,
      'tier:owl',
      tiers.map((t) => t.weight)
    )
    const t = tiers[idx]!
    return {
      category: 'owl',
      amount: t.amount,
      fairValueSol: t.fairValueSol,
      tierIndex: idx,
    }
  }
  if (category === 'sol') {
    const idx = pickWeightedIndex(
      seed,
      'tier:sol',
      PACK_SOL_TIERS.map((t) => t.weight)
    )
    const t = PACK_SOL_TIERS[idx]!
    return {
      category: 'sol',
      amountSol: t.amountSol,
      fairValueSol: t.amountSol,
      tierIndex: idx,
    }
  }
  const idx = pickWeightedIndex(
    seed,
    'tier:nft',
    PACK_NFT_VALUE_BANDS.map((b) => b.weight)
  )
  const b = PACK_NFT_VALUE_BANDS[idx]!
  return {
    category: 'nft',
    bandIndex: idx,
    minFairValueSol: b.minFairValueSol,
    maxFairValueSol: b.maxFairValueSol,
  }
}

/** Recompute category + tier from a published seed (verify page). */
export function recomputeOpenFromSeed(
  seed: string,
  owlSolPrice?: number | null
): { category: PackPrizeCategory; pick: WeightedTierPick } {
  const category = pickCategory(seed)
  const pick = pickTier(seed, category, owlSolPrice)
  return { category, pick }
}

export function verifyCommitHash(seed: string, commitHash: string): boolean {
  return hashDrawCommit(seed.trim()) === commitHash.trim().toLowerCase()
}
