/**
 * OwlSend holder fee discount — Discord hold-role thresholds (Gen1 / Gen2).
 * Discount applies to the Owl platform fee only (not ATA rent / network).
 *
 * Rank is computed per generation from hold count; the better of Gen1/Gen2 wins.
 * Founder and GEMBIRD both cap at 50%.
 */

export const OWL_SEND_GEN1_ROLE_THRESHOLDS = [1, 3, 5, 10, 20, 30] as const
export const OWL_SEND_GEN2_ROLE_THRESHOLDS = [1, 5, 10, 20, 30, 60] as const

/** Stop counting past these — enough for top GEMBIRD rank. */
export const OWL_SEND_GEN1_COUNT_CAP = OWL_SEND_GEN1_ROLE_THRESHOLDS[OWL_SEND_GEN1_ROLE_THRESHOLDS.length - 1]!
export const OWL_SEND_GEN2_COUNT_CAP = OWL_SEND_GEN2_ROLE_THRESHOLDS[OWL_SEND_GEN2_ROLE_THRESHOLDS.length - 1]!

export type OwlSendHolderRoleName =
  | 'OwlHolder'
  | 'OwlLilWhale'
  | 'OwlWhale'
  | 'OwlCEO'
  | 'OwlFounder'
  | 'GEMBIRD'

/** Rank 1..6 maps to Discord role names; discount bps for that rank. */
export const OWL_SEND_HOLDER_ROLE_LADDER: ReadonlyArray<{
  rank: number
  name: OwlSendHolderRoleName
  discountBps: number
}> = [
  { rank: 1, name: 'OwlHolder', discountBps: 1_000 },
  { rank: 2, name: 'OwlLilWhale', discountBps: 2_000 },
  { rank: 3, name: 'OwlWhale', discountBps: 3_000 },
  { rank: 4, name: 'OwlCEO', discountBps: 4_000 },
  { rank: 5, name: 'OwlFounder', discountBps: 5_000 },
  { rank: 6, name: 'GEMBIRD', discountBps: 5_000 },
]

export function clampOwlSendDiscountBps(bps: number): number {
  if (!Number.isFinite(bps)) return 0
  return Math.min(10_000, Math.max(0, Math.floor(bps)))
}

/** Highest role rank for a hold count given ascending thresholds (1-based), or 0. */
export function owlSendRoleRankFromCount(
  count: number,
  thresholds: readonly number[]
): number {
  const n = Math.max(0, Math.floor(count))
  if (n < 1 || thresholds.length < 1) return 0
  let rank = 0
  for (let i = 0; i < thresholds.length; i++) {
    if (n >= thresholds[i]!) rank = i + 1
    else break
  }
  return rank
}

export function owlSendHolderRoleAtRank(rank: number): {
  rank: number
  name: OwlSendHolderRoleName
  discountBps: number
} | null {
  const r = Math.floor(rank)
  if (r < 1) return null
  const entry = OWL_SEND_HOLDER_ROLE_LADDER.find((x) => x.rank === r)
  return entry ?? null
}

export type OwlSendHolderDiscountQuote = {
  gen1Count: number
  gen2Count: number
  gen1Rank: number
  gen2Rank: number
  /** Best of Gen1 / Gen2 ranks. */
  bestRank: number
  roleName: OwlSendHolderRoleName | null
  discountBps: number
  discountPercent: number
}

/** Pure: map Gen1/Gen2 counts → discount (Discord role ladders). */
export function quoteOwlSendHolderDiscount(params: {
  gen1Count: number
  gen2Count: number
}): OwlSendHolderDiscountQuote {
  const gen1Count = Math.max(0, Math.floor(params.gen1Count))
  const gen2Count = Math.max(0, Math.floor(params.gen2Count))
  const gen1Rank = owlSendRoleRankFromCount(gen1Count, OWL_SEND_GEN1_ROLE_THRESHOLDS)
  const gen2Rank = owlSendRoleRankFromCount(gen2Count, OWL_SEND_GEN2_ROLE_THRESHOLDS)
  const bestRank = Math.max(gen1Rank, gen2Rank)
  const role = owlSendHolderRoleAtRank(bestRank)
  const discountBps = role?.discountBps ?? 0
  return {
    gen1Count,
    gen2Count,
    gen1Rank,
    gen2Rank,
    bestRank,
    roleName: role?.name ?? null,
    discountBps,
    discountPercent: discountBps / 100,
  }
}

/** Apply discount bps to base per-line lamports (floor), then × line count. */
export function applyOwlSendFeeDiscountLamports(
  baseLamportsPerLine: number,
  lineCount: number,
  discountBps: number
): number {
  const base = Math.max(0, Math.floor(baseLamportsPerLine))
  const n = Math.max(0, Math.floor(lineCount))
  if (base <= 0 || n <= 0) return 0
  const bps = clampOwlSendDiscountBps(discountBps)
  const perLine = Math.floor((base * (10_000 - bps)) / 10_000)
  return perLine * n
}
