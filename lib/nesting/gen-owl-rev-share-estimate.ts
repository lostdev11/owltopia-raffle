import { countActiveGenOwlNestsByGroup, listActiveGenOwlNestMintsByGroup } from '@/lib/db/gen-owl-rev-share-stats'
import { getGenOwlRevSharePeriod } from '@/lib/db/gen-owl-rev-share-periods'
import { getRevShareSchedule } from '@/lib/db/rev-share-schedule'
import { listStakingPositionsByWallet } from '@/lib/db/staking-positions'
import { getStakingPoolById } from '@/lib/db/staking-pools'
import { classifyGen1OneOfOneMints } from '@/lib/nesting/gen1-one-of-one'
import {
  computeEvenRevSharePerNest,
  computeGen1RevShareBucketAmounts,
  formatGenOwlRevShareSol,
  formatGenOwlRevShareUsdc,
} from '@/lib/nesting/gen-owl-rev-share'
import {
  claimsOpenForPeriod,
  formatPeriodMonthLabel,
  formatPeriodMonthUtc,
  groupKeyForPoolSlug,
  scheduleTotalsApplyToPeriod,
} from '@/lib/nesting/gen-owl-rev-share-month'
import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'

export type GenOwlRevShareEstimateRow = {
  position_id: string
  pool_name: string | null
  asset_identifier: string | null
  group: GenOwlStakingGroupKey
  amount_sol: number
  amount_usdc: number
  bucket: 'standard' | 'one_of_one' | null
}

export type GenOwlRevShareEstimateResult = {
  period_month: string
  period_label: string
  is_estimate: boolean
  claims_open: boolean
  pool_gen1_sol: number
  pool_gen1_usdc: number
  pool_gen2_sol: number
  pool_gen2_usdc: number
  nests: GenOwlRevShareEstimateRow[]
  total_sol: number
  total_usdc: number
}

function positive(n: number | null | undefined): number {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? v : 0
}

/**
 * Projected monthly rev share for the wallet's active Gen 1 / Gen 2 nests
 * based on deposited period totals ÷ live nest counts (estimate until claim opens / finalize).
 */
export async function getGenOwlRevShareEstimateForWallet(
  wallet: string
): Promise<GenOwlRevShareEstimateResult | null> {
  const periodMonth = formatPeriodMonthUtc(new Date())
  const period = await getGenOwlRevSharePeriod(periodMonth)
  const schedule = await getRevShareSchedule()

  // After finalize, only deposited period totals count. Before finalize, schedule
  // display amounts may preview — but only when that gen's next date is this month
  // (so Gen 2 August pool does not show under July).
  const finalized = Boolean(period?.finalized_at)
  const useGen1Schedule =
    !finalized && scheduleTotalsApplyToPeriod(schedule?.gen1_next_date ?? schedule?.next_date, periodMonth)
  const useGen2Schedule =
    !finalized && scheduleTotalsApplyToPeriod(schedule?.gen2_next_date ?? schedule?.next_date, periodMonth)

  const pool_gen1_sol = positive(
    period?.gen1_total_sol ?? (useGen1Schedule ? schedule?.gen1_total_sol : null)
  )
  const pool_gen1_usdc = positive(
    period?.gen1_total_usdc ?? (useGen1Schedule ? schedule?.gen1_total_usdc : null)
  )
  const pool_gen2_sol = positive(
    period?.gen2_total_sol ?? (useGen2Schedule ? schedule?.gen2_total_sol : null)
  )
  const pool_gen2_usdc = positive(
    period?.gen2_total_usdc ?? (useGen2Schedule ? schedule?.gen2_total_usdc : null)
  )

  if (pool_gen1_sol <= 0 && pool_gen1_usdc <= 0 && pool_gen2_sol <= 0 && pool_gen2_usdc <= 0) {
    return null
  }

  const positions = await listStakingPositionsByWallet(wallet)
  const active = positions.filter((p) => p.status === 'active')
  if (active.length === 0) return null

  const counts = await countActiveGenOwlNestsByGroup()
  const gen1Mints = await listActiveGenOwlNestMintsByGroup('gen1-owl')
  const classification = await classifyGen1OneOfOneMints(gen1Mints)
  let standardCount = 0
  let oneOfOneCount = 0
  for (const mint of gen1Mints) {
    if (classification.get(mint) === 'one-of-one') oneOfOneCount++
    else standardCount++
  }

  const gen1Buckets = computeGen1RevShareBucketAmounts({
    totalSol: pool_gen1_sol || null,
    totalUsdc: pool_gen1_usdc || null,
    standardCount,
    oneOfOneCount,
  })
  const gen2PerSol = computeEvenRevSharePerNest(pool_gen2_sol || null, counts['gen2-owl'])
  const gen2PerUsdc = computeEvenRevSharePerNest(pool_gen2_usdc || null, counts['gen2-owl'])

  const nests: GenOwlRevShareEstimateRow[] = []
  let total_sol = 0
  let total_usdc = 0

  for (const position of active) {
    const pool = await getStakingPoolById(position.pool_id)
    const group = groupKeyForPoolSlug(pool?.slug)
    if (!group) continue

    let amount_sol = 0
    let amount_usdc = 0
    let bucket: 'standard' | 'one_of_one' | null = null

    if (group === 'gen2-owl') {
      amount_sol = gen2PerSol ?? 0
      amount_usdc = gen2PerUsdc ?? 0
    } else {
      const mint = position.asset_identifier?.trim()
      const isOoo = mint ? classification.get(mint) === 'one-of-one' : false
      bucket = isOoo ? 'one_of_one' : 'standard'
      if (isOoo) {
        amount_sol = gen1Buckets.one_of_one_per_nest_sol ?? 0
        amount_usdc = gen1Buckets.one_of_one_per_nest_usdc ?? 0
      } else {
        amount_sol = gen1Buckets.standard_per_nest_sol ?? 0
        amount_usdc = gen1Buckets.standard_per_nest_usdc ?? 0
      }
    }

    if (amount_sol <= 0 && amount_usdc <= 0) continue

    nests.push({
      position_id: position.id,
      pool_name: pool?.name ?? null,
      asset_identifier: position.asset_identifier,
      group,
      amount_sol,
      amount_usdc,
      bucket,
    })
    total_sol += amount_sol
    total_usdc += amount_usdc
  }

  if (nests.length === 0) return null

  return {
    period_month: periodMonth,
    period_label: formatPeriodMonthLabel(periodMonth),
    is_estimate: !period?.finalized_at,
    claims_open: claimsOpenForPeriod(periodMonth),
    pool_gen1_sol,
    pool_gen1_usdc,
    pool_gen2_sol,
    pool_gen2_usdc,
    nests,
    total_sol,
    total_usdc,
  }
}

export { formatGenOwlRevShareSol, formatGenOwlRevShareUsdc }
