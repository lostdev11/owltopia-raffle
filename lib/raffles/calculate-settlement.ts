export interface SettlementResult {
  grossRevenue: number
  feeBps: number
  platformFee: number
  creatorPayout: number
}

/**
 * Calculate settlement amounts for a raffle.
 *
 * Uses integer math with a fixed scale to reduce floating point precision issues.
 */
export function calculateSettlement(grossRevenue: number, feeBps: number): SettlementResult {
  const safeGross = Number.isFinite(grossRevenue) && grossRevenue > 0 ? grossRevenue : 0
  const safeFeeBps = Number.isFinite(feeBps) && feeBps >= 0 ? feeBps : 0

  // Scale gross revenue to 1e9 to keep precision in integer space.
  const SCALE = 1_000_000_000
  const scaledGross = Math.round(safeGross * SCALE)
  const scaledFee = Math.floor((scaledGross * safeFeeBps) / 10_000)
  const scaledPayout = scaledGross - scaledFee

  const platformFee = scaledFee / SCALE
  const creatorPayout = scaledPayout / SCALE

  return {
    grossRevenue: safeGross,
    feeBps: safeFeeBps,
    platformFee,
    creatorPayout,
  }
}

