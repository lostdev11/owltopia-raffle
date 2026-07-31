import {
  clearGenOwlRevSharePeriodFinalization,
  finalizeGenOwlRevSharePeriod,
  getGenOwlRevSharePeriod,
  type GenOwlRevSharePeriodRow,
} from '@/lib/db/gen-owl-rev-share-periods'
import { countActiveGenOwlNestsByGroup } from '@/lib/db/gen-owl-rev-share-stats'
import {
  computeEvenRevSharePerNest,
  computeGen1RevShareBucketAmounts,
} from '@/lib/nesting/gen-owl-rev-share'
import {
  countEligibleByGroup,
  countGen1EligibleByRevShareBucket,
  listEligibleGenOwlNestsForPeriod,
} from '@/lib/nesting/gen-owl-rev-share-eligibility'
import { claimsOpenForPeriod } from '@/lib/nesting/gen-owl-rev-share-month'
import { StakingUserError } from '@/lib/nesting/errors'

function periodHasDepositTotals(period: GenOwlRevSharePeriodRow): boolean {
  return (
    (Number(period.gen1_total_sol) || 0) > 0 ||
    (Number(period.gen1_total_usdc) || 0) > 0 ||
    (Number(period.gen2_total_sol) || 0) > 0 ||
    (Number(period.gen2_total_usdc) || 0) > 0
  )
}

/**
 * Refuse to snapshot if eligible << live active for a funded gen.
 * Catches PostgREST truncation / partial listing before overpaying per nest.
 * Unstaked-after-month-end can make eligible > active; only guard the under-count case.
 */
function assertEligibleCountsPlausible(params: {
  periodMonth: string
  eligibleGen1: number
  eligibleGen2: number
  activeGen1: number
  activeGen2: number
  hasGen1Pool: boolean
  hasGen2Pool: boolean
}): void {
  const { periodMonth, eligibleGen1, eligibleGen2, activeGen1, activeGen2, hasGen1Pool, hasGen2Pool } =
    params

  const check = (label: string, eligible: number, active: number, hasPool: boolean) => {
    if (!hasPool || active < 20) return
    // Allow some churn, but not "37 of 241" style undercounts.
    const minExpected = Math.floor(active * 0.75)
    if (eligible < minExpected) {
      throw new StakingUserError(
        `Rev share finalize for ${periodMonth} refused: ${label} eligible nests (${eligible}) are far below live active (${active}). Recompute after fixing listing/pagination — do not open claims on this snapshot.`,
        500
      )
    }
  }

  check('Gen 1', eligibleGen1, activeGen1, hasGen1Pool)
  check('Gen 2', eligibleGen2, activeGen2, hasGen2Pool)
}

/**
 * Period rows are created/credited only by verified admin deposits — never seeded from
 * homepage schedule display amounts (those can be set without on-chain funding).
 */
export async function ensureGenOwlRevSharePeriodRow(periodMonth: string): Promise<GenOwlRevSharePeriodRow | null> {
  return getGenOwlRevSharePeriod(periodMonth)
}

async function computeAndWriteFinalize(period: GenOwlRevSharePeriodRow): Promise<GenOwlRevSharePeriodRow | null> {
  const nests = await listEligibleGenOwlNestsForPeriod(period.period_month)
  const counts = countEligibleByGroup(nests)
  const active = await countActiveGenOwlNestsByGroup()

  assertEligibleCountsPlausible({
    periodMonth: period.period_month,
    eligibleGen1: counts['gen1-owl'],
    eligibleGen2: counts['gen2-owl'],
    activeGen1: active['gen1-owl'],
    activeGen2: active['gen2-owl'],
    hasGen1Pool: (Number(period.gen1_total_sol) || 0) > 0 || (Number(period.gen1_total_usdc) || 0) > 0,
    hasGen2Pool: (Number(period.gen2_total_sol) || 0) > 0 || (Number(period.gen2_total_usdc) || 0) > 0,
  })

  const gen1Buckets = await countGen1EligibleByRevShareBucket(nests)
  const gen1Amounts = computeGen1RevShareBucketAmounts({
    totalSol: period.gen1_total_sol,
    totalUsdc: period.gen1_total_usdc,
    standardCount: gen1Buckets.standard,
    oneOfOneCount: gen1Buckets.one_of_one,
  })

  return finalizeGenOwlRevSharePeriod({
    period_month: period.period_month,
    gen1_eligible_count: counts['gen1-owl'],
    gen2_eligible_count: counts['gen2-owl'],
    gen1_standard_eligible_count: gen1Amounts.standard_count,
    gen1_one_of_one_eligible_count: gen1Amounts.one_of_one_count,
    gen1_per_nest_sol: gen1Amounts.standard_per_nest_sol,
    gen1_per_nest_usdc: gen1Amounts.standard_per_nest_usdc,
    gen1_standard_per_nest_sol: gen1Amounts.standard_per_nest_sol,
    gen1_standard_per_nest_usdc: gen1Amounts.standard_per_nest_usdc,
    gen1_one_of_one_per_nest_sol: gen1Amounts.one_of_one_per_nest_sol,
    gen1_one_of_one_per_nest_usdc: gen1Amounts.one_of_one_per_nest_usdc,
    gen2_per_nest_sol: computeEvenRevSharePerNest(period.gen2_total_sol, counts['gen2-owl']),
    gen2_per_nest_usdc: computeEvenRevSharePerNest(period.gen2_total_usdc, counts['gen2-owl']),
  })
}

/** Snapshot eligible nest counts and per-nest amounts when claims open. */
export async function ensureGenOwlRevSharePeriodFinalized(
  periodMonth: string
): Promise<GenOwlRevSharePeriodRow | null> {
  if (!claimsOpenForPeriod(periodMonth)) return null

  let period = await ensureGenOwlRevSharePeriodRow(periodMonth)
  if (!period || !periodHasDepositTotals(period)) return null

  if (period.finalized_at) {
    // Block payouts on known-bad snapshots (e.g. PostgREST under-count) until admin recomputes.
    const active = await countActiveGenOwlNestsByGroup()
    try {
      assertEligibleCountsPlausible({
        periodMonth,
        eligibleGen1: period.gen1_eligible_count ?? 0,
        eligibleGen2: period.gen2_eligible_count ?? 0,
        activeGen1: active['gen1-owl'],
        activeGen2: active['gen2-owl'],
        hasGen1Pool: (Number(period.gen1_total_sol) || 0) > 0 || (Number(period.gen1_total_usdc) || 0) > 0,
        hasGen2Pool: (Number(period.gen2_total_sol) || 0) > 0 || (Number(period.gen2_total_usdc) || 0) > 0,
      })
    } catch (e) {
      console.error('[gen-owl-rev-share] rejecting stale under-counted finalize:', e)
      return null
    }
    return period
  }

  return computeAndWriteFinalize(period)
}

/**
 * Admin repair: clear a bad finalize snapshot and recompute with current eligibility
 * (e.g. after fixing PostgREST pagination that under-counted nests).
 * Allowed even while the claims kill switch is off.
 */
export async function forceRefinalizeGenOwlRevSharePeriod(
  periodMonth: string
): Promise<GenOwlRevSharePeriodRow | null> {
  if (!claimsOpenForPeriod(periodMonth)) {
    return null
  }

  let period = await ensureGenOwlRevSharePeriodRow(periodMonth)
  if (!period || !periodHasDepositTotals(period)) return null

  if (period.finalized_at) {
    period = await clearGenOwlRevSharePeriodFinalization(periodMonth)
    if (!period) return null
  }

  return computeAndWriteFinalize(period)
}
