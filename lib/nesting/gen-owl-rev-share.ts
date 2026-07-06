import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'

export type GenOwlRevShareTotals = {
  total_sol: number | null
  total_usdc: number | null
}

export type GenOwlRevSharePreview = {
  group: GenOwlStakingGroupKey
  label: string
  active_nest_count: number
  totals: GenOwlRevShareTotals
  per_nest_sol: number | null
  per_nest_usdc: number | null
}

function safePositiveNumber(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/** Even split: total ÷ active nest count (one share per nested NFT). */
export function computeEvenRevSharePerNest(total: number | null, activeNestCount: number): number | null {
  const amount = safePositiveNumber(total)
  if (amount == null || activeNestCount <= 0) return null
  return amount / activeNestCount
}

export function buildGenOwlRevSharePreview(params: {
  group: GenOwlStakingGroupKey
  label: string
  activeNestCount: number
  totalSol: number | null
  totalUsdc: number | null
}): GenOwlRevSharePreview {
  const count = Math.max(0, Math.floor(params.activeNestCount))
  const totals: GenOwlRevShareTotals = {
    total_sol: safePositiveNumber(params.totalSol),
    total_usdc: safePositiveNumber(params.totalUsdc),
  }
  return {
    group: params.group,
    label: params.label,
    active_nest_count: count,
    totals,
    per_nest_sol: computeEvenRevSharePerNest(totals.total_sol, count),
    per_nest_usdc: computeEvenRevSharePerNest(totals.total_usdc, count),
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
