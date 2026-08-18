/**
 * Packs ripping — locked MVP product constants (Gembird / Owltopia Discord).
 *
 * - Pack price: 0.1 SOL
 * - Every open wins
 * - Categories: 60% OWL / 20% SOL / 20% NFT
 * - Scales: OWL 5–100, SOL 0.05–0.5, NFT fair value 0.05–0.5 SOL
 * - Target RTP: 80% (EV ≈ 0.08 SOL per open)
 * - OWL wins credit free raffle tickets (default 1 OWL → 1 ticket)
 */

export const PACKS_PRODUCT_SLUG = 'owl-pack-v1' as const

/** MVP pack price in SOL */
export const PACK_PRICE_SOL = 0.1

/** Target return-to-player in basis points (8000 = 80%) */
export const PACK_RTP_BPS = 8000

/** Expected prize value in SOL at target RTP */
export const PACK_TARGET_EV_SOL = (PACK_PRICE_SOL * PACK_RTP_BPS) / 10_000

export type PackPrizeCategory = 'owl' | 'sol' | 'nft'

/** Category weights in basis points (must sum to 10_000) */
export const PACK_CATEGORY_WEIGHTS_BPS: Record<PackPrizeCategory, number> = {
  owl: 6000,
  sol: 2000,
  nft: 2000,
}

export type PackOwlTier = {
  category: 'owl'
  /** OWL amount paid out */
  amount: number
  /** Relative weight within OWL category */
  weight: number
  /** SOL-equivalent fair value used for EV math (admin-tunable via env override later) */
  fairValueSol: number
}

export type PackSolTier = {
  category: 'sol'
  amountSol: number
  weight: number
}

export type PackNftValueBand = {
  category: 'nft'
  /** Inclusive min fair value (SOL) */
  minFairValueSol: number
  /** Inclusive max fair value (SOL) */
  maxFairValueSol: number
  weight: number
}

/**
 * Bottom-heavy OWL ladder (5 → 100). Fair values assume a placeholder OWL/SOL rate
 * overwritten at runtime by `estimateOwlFairValueSol` when a price is provided.
 * Default assumes ~0.002 SOL per OWL so mid tiers stay near EV target.
 */
export const PACK_OWL_TIERS: PackOwlTier[] = [
  { category: 'owl', amount: 5, weight: 400, fairValueSol: 0.01 },
  { category: 'owl', amount: 10, weight: 280, fairValueSol: 0.02 },
  { category: 'owl', amount: 25, weight: 180, fairValueSol: 0.05 },
  { category: 'owl', amount: 50, weight: 100, fairValueSol: 0.1 },
  { category: 'owl', amount: 100, weight: 40, fairValueSol: 0.2 },
]

export const PACK_SOL_TIERS: PackSolTier[] = [
  { category: 'sol', amountSol: 0.05, weight: 450 },
  { category: 'sol', amountSol: 0.1, weight: 300 },
  { category: 'sol', amountSol: 0.25, weight: 180 },
  { category: 'sol', amountSol: 0.5, weight: 70 },
]

export const PACK_NFT_VALUE_BANDS: PackNftValueBand[] = [
  { category: 'nft', minFairValueSol: 0.05, maxFairValueSol: 0.1, weight: 450 },
  { category: 'nft', minFairValueSol: 0.1, maxFairValueSol: 0.25, weight: 350 },
  { category: 'nft', minFairValueSol: 0.25, maxFairValueSol: 0.5, weight: 200 },
]

/** Default free raffle ticket credits per OWL won (Gembird: 10 OWL → 10 tickets) */
export const PACK_OWL_TO_TICKET_RATIO = 1

export const PACK_OPEN_ALGO = 'owltopia-pack-open-v1' as const

export function packPriceLamports(): bigint {
  return BigInt(Math.round(PACK_PRICE_SOL * 1_000_000_000))
}

export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * 1_000_000_000))
}

/**
 * Scale OWL tier fair values when a live OWL/SOL price is known.
 * `owlSolPrice` = SOL per 1 OWL.
 */
export function owlTiersWithPrice(owlSolPrice: number | null | undefined): PackOwlTier[] {
  if (!owlSolPrice || !(owlSolPrice > 0)) return PACK_OWL_TIERS
  return PACK_OWL_TIERS.map((t) => ({
    ...t,
    fairValueSol: t.amount * owlSolPrice,
  }))
}
