import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'
import {
  GEN_OWL_REV_SHARE_ONE_OF_ONE_POOL_FRACTION,
  GEN_OWL_REV_SHARE_STANDARD_POOL_FRACTION,
} from '@/lib/nesting/gen-owl-rev-share-copy'

export type GenOwlRevShareTotals = {
  total_sol: number | null
  total_usdc: number | null
}

/** 90/10 bucket preview shared by Gen 1 and Gen 2. */
export type GenOwlRevShareBucketPreview = {
  standard_count: number
  one_of_one_count: number
  standard_per_nest_sol: number | null
  standard_per_nest_usdc: number | null
  one_of_one_per_nest_sol: number | null
  one_of_one_per_nest_usdc: number | null
}

/** @deprecated Use GenOwlRevShareBucketPreview */
export type Gen1RevShareBucketPreview = GenOwlRevShareBucketPreview

export type GenOwlRevSharePreview = {
  group: GenOwlStakingGroupKey
  label: string
  active_nest_count: number
  totals: GenOwlRevShareTotals
  per_nest_sol: number | null
  per_nest_usdc: number | null
  /** Present when 90/10 bucket counts are known (Gen 1 and Gen 2). */
  buckets?: GenOwlRevShareBucketPreview
  /**
   * Alias of `buckets` for Gen 1 responses (older admin clients).
   * Prefer `buckets`.
   */
  gen1_buckets?: GenOwlRevShareBucketPreview
}

export type GenOwlRevShareBucketAmounts = GenOwlRevShareBucketPreview
/** @deprecated Use GenOwlRevShareBucketAmounts */
export type Gen1RevShareBucketAmounts = GenOwlRevShareBucketAmounts

function safePositiveNumber(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/** Even split: total ÷ active nest count. */
export function computeEvenRevSharePerNest(total: number | null, activeNestCount: number): number | null {
  const amount = safePositiveNumber(total)
  if (amount == null || activeNestCount <= 0) return null
  return amount / activeNestCount
}

function poolFractionsForBuckets(standardCount: number, oneOfOneCount: number): {
  standard: number
  one_of_one: number
} {
  const std = Math.max(0, Math.floor(standardCount))
  const ooo = Math.max(0, Math.floor(oneOfOneCount))
  if (std <= 0 && ooo <= 0) return { standard: 0, one_of_one: 0 }
  if (ooo <= 0) return { standard: 1, one_of_one: 0 }
  if (std <= 0) return { standard: 0, one_of_one: 1 }
  return {
    standard: GEN_OWL_REV_SHARE_STANDARD_POOL_FRACTION,
    one_of_one: GEN_OWL_REV_SHARE_ONE_OF_ONE_POOL_FRACTION,
  }
}

/**
 * Gen 1 / Gen 2: 90% divided evenly across ALL staked nests; 10% bonus divided across 1/1s.
 * Each 1/1 receives both shares. Empty bucket → full pool to the other side.
 */
export function computeGenOwlRevShareBucketAmounts(params: {
  totalSol: number | null
  totalUsdc: number | null
  standardCount: number
  oneOfOneCount: number
}): GenOwlRevShareBucketAmounts {
  const standard_count = Math.max(0, Math.floor(params.standardCount))
  const one_of_one_count = Math.max(0, Math.floor(params.oneOfOneCount))
  const all_count = standard_count + one_of_one_count
  const fractions = poolFractionsForBuckets(standard_count, one_of_one_count)

  const totalSol = safePositiveNumber(params.totalSol)
  const totalUsdc = safePositiveNumber(params.totalUsdc)

  const allStakedSolPool = totalSol != null ? totalSol * fractions.standard : null
  const oneOfOneBonusSolPool = totalSol != null ? totalSol * fractions.one_of_one : null
  const allStakedUsdcPool = totalUsdc != null ? totalUsdc * fractions.standard : null
  const oneOfOneBonusUsdcPool = totalUsdc != null ? totalUsdc * fractions.one_of_one : null

  const standard_per_nest_sol = computeEvenRevSharePerNest(allStakedSolPool, all_count)
  const standard_per_nest_usdc = computeEvenRevSharePerNest(allStakedUsdcPool, all_count)

  const bonus_sol = computeEvenRevSharePerNest(oneOfOneBonusSolPool, one_of_one_count)
  const bonus_usdc = computeEvenRevSharePerNest(oneOfOneBonusUsdcPool, one_of_one_count)

  const sumShares = (base: number | null, bonus: number | null): number | null => {
    if (base == null && bonus == null) return null
    return (base ?? 0) + (bonus ?? 0)
  }

  return {
    standard_count,
    one_of_one_count,
    standard_per_nest_sol,
    standard_per_nest_usdc,
    one_of_one_per_nest_sol:
      one_of_one_count > 0 ? sumShares(standard_per_nest_sol, bonus_sol) : null,
    one_of_one_per_nest_usdc:
      one_of_one_count > 0 ? sumShares(standard_per_nest_usdc, bonus_usdc) : null,
  }
}

/** @deprecated Use computeGenOwlRevShareBucketAmounts */
export const computeGen1RevShareBucketAmounts = computeGenOwlRevShareBucketAmounts

export function buildGenOwlRevSharePreview(params: {
  group: GenOwlStakingGroupKey
  label: string
  activeNestCount: number
  totalSol: number | null
  totalUsdc: number | null
  buckets?: GenOwlRevShareBucketPreview
  /** @deprecated Use buckets */
  gen1Buckets?: GenOwlRevShareBucketPreview
}): GenOwlRevSharePreview {
  const count = Math.max(0, Math.floor(params.activeNestCount))
  const totals: GenOwlRevShareTotals = {
    total_sol: safePositiveNumber(params.totalSol),
    total_usdc: safePositiveNumber(params.totalUsdc),
  }

  const buckets = params.buckets ?? params.gen1Buckets

  return {
    group: params.group,
    label: params.label,
    active_nest_count: count,
    totals,
    per_nest_sol: buckets
      ? buckets.standard_per_nest_sol ?? null
      : computeEvenRevSharePerNest(totals.total_sol, count),
    per_nest_usdc: buckets
      ? buckets.standard_per_nest_usdc ?? null
      : computeEvenRevSharePerNest(totals.total_usdc, count),
    buckets,
    gen1_buckets: params.group === 'gen1-owl' ? buckets : undefined,
  }
}

export function gen1RevShareUsesBucketColumns(period: {
  gen1_standard_per_nest_sol?: number | null
  gen1_one_of_one_per_nest_sol?: number | null
}): boolean {
  return (
    period.gen1_standard_per_nest_sol != null || period.gen1_one_of_one_per_nest_sol != null
  )
}

export function gen2RevShareUsesBucketColumns(period: {
  gen2_standard_per_nest_sol?: number | null
  gen2_one_of_one_per_nest_sol?: number | null
}): boolean {
  return (
    period.gen2_standard_per_nest_sol != null || period.gen2_one_of_one_per_nest_sol != null
  )
}

export function resolveGen1PerNestAmounts(
  period: {
    gen1_per_nest_sol?: number | null
    gen1_per_nest_usdc?: number | null
    gen1_standard_per_nest_sol?: number | null
    gen1_standard_per_nest_usdc?: number | null
    gen1_one_of_one_per_nest_sol?: number | null
    gen1_one_of_one_per_nest_usdc?: number | null
  },
  bucket: 'standard' | 'one-of-one'
): { sol: number; usdc: number } {
  if (gen1RevShareUsesBucketColumns(period)) {
    if (bucket === 'one-of-one') {
      return {
        sol: period.gen1_one_of_one_per_nest_sol ?? 0,
        usdc: period.gen1_one_of_one_per_nest_usdc ?? 0,
      }
    }
    return {
      sol: period.gen1_standard_per_nest_sol ?? 0,
      usdc: period.gen1_standard_per_nest_usdc ?? 0,
    }
  }
  return {
    sol: period.gen1_per_nest_sol ?? 0,
    usdc: period.gen1_per_nest_usdc ?? 0,
  }
}

export function resolveGen2PerNestAmounts(
  period: {
    gen2_per_nest_sol?: number | null
    gen2_per_nest_usdc?: number | null
    gen2_standard_per_nest_sol?: number | null
    gen2_standard_per_nest_usdc?: number | null
    gen2_one_of_one_per_nest_sol?: number | null
    gen2_one_of_one_per_nest_usdc?: number | null
  },
  bucket: 'standard' | 'one-of-one'
): { sol: number; usdc: number } {
  if (gen2RevShareUsesBucketColumns(period)) {
    if (bucket === 'one-of-one') {
      return {
        sol: period.gen2_one_of_one_per_nest_sol ?? 0,
        usdc: period.gen2_one_of_one_per_nest_usdc ?? 0,
      }
    }
    return {
      sol: period.gen2_standard_per_nest_sol ?? 0,
      usdc: period.gen2_standard_per_nest_usdc ?? 0,
    }
  }
  return {
    sol: period.gen2_per_nest_sol ?? 0,
    usdc: period.gen2_per_nest_usdc ?? 0,
  }
}

export function formatGenOwlRevShareSol(amount: number | null): string {
  if (amount == null) return '—'
  return amount.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 9 })
}

export function formatGenOwlRevShareUsdc(amount: number | null): string {
  if (amount == null) return '—'
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
