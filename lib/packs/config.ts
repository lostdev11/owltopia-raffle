/**
 * Packs ripping — locked MVP product constants (Gembird / Owltopia Discord).
 *
 * - Pack price: 0.1 SOL
 * - Every open wins
 * - Categories: 60% OWL / 20% SOL / 20% NFT
 * - Scales: OWL 5–50, SOL 0.05–0.5, NFT fair value 0.05+ SOL (no hard 0.5 cap)
 * - Target RTP: 80% (EV ≈ 0.08 SOL per open)
 * - OWL wins credit free raffle tickets (default 1 OWL → 1 ticket)
 * - NFT picks: inverse floor-price weights (higher FP = rarer)
 * - Randomness: Switchboard VRF when PACK_VRF_ENABLED (else local commit–reveal)
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
 * Bottom-heavy OWL ladder (5 → 50). Fair values assume a placeholder OWL/SOL rate
 * overwritten at runtime by `estimateOwlFairValueSol` when a price is provided.
 * Default assumes ~0.002 SOL per OWL so mid tiers stay near EV target.
 */
export const PACK_OWL_TIERS: PackOwlTier[] = [
  { category: 'owl', amount: 5, weight: 420, fairValueSol: 0.01 },
  { category: 'owl', amount: 10, weight: 290, fairValueSol: 0.02 },
  { category: 'owl', amount: 25, weight: 190, fairValueSol: 0.05 },
  { category: 'owl', amount: 50, weight: 100, fairValueSol: 0.1 },
]

export const PACK_SOL_TIERS: PackSolTier[] = [
  { category: 'sol', amountSol: 0.05, weight: 450 },
  { category: 'sol', amountSol: 0.1, weight: 300 },
  { category: 'sol', amountSol: 0.25, weight: 180 },
  { category: 'sol', amountSol: 0.5, weight: 70 },
]

/** Legacy band labels (public odds UI still groups inventory by band for display). */
export const PACK_NFT_VALUE_BANDS: PackNftValueBand[] = [
  { category: 'nft', minFairValueSol: 0.05, maxFairValueSol: 0.1, weight: 450 },
  { category: 'nft', minFairValueSol: 0.1, maxFairValueSol: 0.25, weight: 350 },
  { category: 'nft', minFairValueSol: 0.25, maxFairValueSol: 0.5, weight: 200 },
]

/** Min NFT fair value for packs inventory + FP weighting. */
export const PACK_NFT_MIN_FAIR_SOL = 0.05

/** Sanity cap on admin-tagged NFT floor (deposits above this are rejected). */
export const PACK_NFT_MAX_FAIR_SOL = 50

/**
 * Baseline FP reference for inverse weights when the pool max is lower.
 * Keeps legacy 0.05–0.5 pools on the same scale until a higher-FP NFT is added.
 */
export const PACK_NFT_WEIGHT_BASELINE_FAIR_SOL = 0.5

export function isPackNftFairValueSol(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= PACK_NFT_MIN_FAIR_SOL &&
    value <= PACK_NFT_MAX_FAIR_SOL
  )
}

/**
 * Steepness of inverse-FP NFT weights: weight ∝ (maxFp / fairValue)^alpha.
 * 1.0 = linear inverse; higher = steeper rarity for expensive NFTs.
 */
export const PACK_NFT_FP_WEIGHT_ALPHA = 1.0

/** Default free raffle ticket credits per OWL won (Gembird: 10 OWL → 10 tickets) */
export const PACK_OWL_TO_TICKET_RATIO = 1

/** Local commit–reveal (server seed). Used when VRF is off or as documented fallback. */
export const PACK_OPEN_ALGO_V1 = 'owltopia-pack-open-v1' as const

/** Switchboard on-chain VRF seed source. */
export const PACK_OPEN_ALGO_V2_VRF = 'owltopia-pack-open-v2-vrf' as const

/** @deprecated Prefer PACK_OPEN_ALGO_V1 / resolvePackOpenAlgo() */
export const PACK_OPEN_ALGO = PACK_OPEN_ALGO_V1

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
