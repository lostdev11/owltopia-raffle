import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'
import {
  GEN1_REV_SHARE_ONE_OF_ONE_POOL_FRACTION,
  GEN1_REV_SHARE_STANDARD_POOL_FRACTION,
} from '@/lib/nesting/gen-owl-rev-share-copy'

export type GenOwlRevShareTotals = {
  total_sol: number | null
  total_usdc: number | null
}

export type Gen1RevShareBucketPreview = {
  standard_count: number
  one_of_one_count: number
  standard_per_nest_sol: number | null
  standard_per_nest_usdc: number | null
  one_of_one_per_nest_sol: number | null
  one_of_one_per_nest_usdc: number | null
}

export type GenOwlRevSharePreview = {
  group: GenOwlStakingGroupKey
  label: string
  active_nest_count: number
  totals: GenOwlRevShareTotals
  per_nest_sol: number | null
  per_nest_usdc: number | null
  /** Present for Gen 1 previews when bucket counts are known. */
  gen1_buckets?: Gen1RevShareBucketPreview
}

export type Gen1RevShareBucketAmounts = Gen1RevShareBucketPreview

function safePositiveNumber(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/** Gen 2: total ÷ active nest count. */
export function computeEvenRevSharePerNest(total: number | null, activeNestCount: number): number | null {
  const amount = safePositiveNumber(total)
  if (amount == null || activeNestCount <= 0) return null
  return amount / activeNestCount
}

function poolFractionsForGen1Buckets(standardCount: number, oneOfOneCount: number): {
  standard: number
  one_of_one: number
} {
  const std = Math.max(0, Math.floor(standardCount))
  const ooo = Math.max(0, Math.floor(oneOfOneCount))
  if (std <= 0 && ooo <= 0) return { standard: 0, one_of_one: 0 }
  if (ooo <= 0) return { standard: 1, one_of_one: 0 }
  if (std <= 0) return { standard: 0, one_of_one: 1 }
  return {
    standard: GEN1_REV_SHARE_STANDARD_POOL_FRACTION,
    one_of_one: GEN1_REV_SHARE_ONE_OF_ONE_POOL_FRACTION,
  }
}

/** Gen 1: 90% / 10% pools, each split evenly within its bucket. Empty bucket → full pool to the other. */
export function computeGen1RevShareBucketAmounts(params: {
  totalSol: number | null
  totalUsdc: number | null
  standardCount: number
  oneOfOneCount: number
}): Gen1RevShareBucketAmounts {
  const standard_count = Math.max(0, Math.floor(params.standardCount))
  const one_of_one_count = Math.max(0, Math.floor(params.oneOfOneCount))
  const fractions = poolFractionsForGen1Buckets(standard_count, one_of_one_count)

  const totalSol = safePositiveNumber(params.totalSol)
  const totalUsdc = safePositiveNumber(params.totalUsdc)

  const standardSolPool = totalSol != null ? totalSol * fractions.standard : null
  const oneOfOneSolPool = totalSol != null ? totalSol * fractions.one_of_one : null
  const standardUsdcPool = totalUsdc != null ? totalUsdc * fractions.standard : null
  const oneOfOneUsdcPool = totalUsdc != null ? totalUsdc * fractions.one_of_one : null

  return {
    standard_count,
    one_of_one_count,
    standard_per_nest_sol: computeEvenRevSharePerNest(standardSolPool, standard_count),
    standard_per_nest_usdc: computeEvenRevSharePerNest(standardUsdcPool, standard_count),
    one_of_one_per_nest_sol: computeEvenRevSharePerNest(oneOfOneSolPool, one_of_one_count),
    one_of_one_per_nest_usdc: computeEvenRevSharePerNest(oneOfOneUsdcPool, one_of_one_count),
  }
}

export function buildGenOwlRevSharePreview(params: {
  group: GenOwlStakingGroupKey
  label: string
  activeNestCount: number
  totalSol: number | null
  totalUsdc: number | null
  gen1Buckets?: Gen1RevShareBucketPreview
}): GenOwlRevSharePreview {
  const count = Math.max(0, Math.floor(params.activeNestCount))
  const totals: GenOwlRevShareTotals = {
    total_sol: safePositiveNumber(params.totalSol),
    total_usdc: safePositiveNumber(params.totalUsdc),
  }

  const gen1_buckets =
    params.group === 'gen1-owl' ? params.gen1Buckets : undefined

  return {
    group: params.group,
    label: params.label,
    active_nest_count: count,
    totals,
    per_nest_sol:
      params.group === 'gen2-owl'
        ? computeEvenRevSharePerNest(totals.total_sol, count)
        : gen1_buckets?.standard_per_nest_sol ?? null,
    per_nest_usdc:
      params.group === 'gen2-owl'
        ? computeEvenRevSharePerNest(totals.total_usdc, count)
        : gen1_buckets?.standard_per_nest_usdc ?? null,
    gen1_buckets,
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

export function formatGenOwlRevShareSol(amount: number | null): string {
  if (amount == null) return '—'
  return amount.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 9 })
}

export function formatGenOwlRevShareUsdc(amount: number | null): string {
  if (amount == null) return '—'
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
