import {
  finalizeGenOwlRevSharePeriod,
  getGenOwlRevSharePeriod,
  type GenOwlRevSharePeriodRow,
} from '@/lib/db/gen-owl-rev-share-periods'
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

function periodHasDepositTotals(period: GenOwlRevSharePeriodRow): boolean {
  return (
    (Number(period.gen1_total_sol) || 0) > 0 ||
    (Number(period.gen1_total_usdc) || 0) > 0 ||
    (Number(period.gen2_total_sol) || 0) > 0 ||
    (Number(period.gen2_total_usdc) || 0) > 0
  )
}

/**
 * Period rows are created/credited only by verified admin deposits — never seeded from
 * homepage schedule display amounts (those can be set without on-chain funding).
 */
export async function ensureGenOwlRevSharePeriodRow(periodMonth: string): Promise<GenOwlRevSharePeriodRow | null> {
  return getGenOwlRevSharePeriod(periodMonth)
}

/** Snapshot eligible nest counts and per-nest amounts when claims open. */
export async function ensureGenOwlRevSharePeriodFinalized(
  periodMonth: string
): Promise<GenOwlRevSharePeriodRow | null> {
  if (!claimsOpenForPeriod(periodMonth)) return null

  let period = await ensureGenOwlRevSharePeriodRow(periodMonth)
  if (!period || !periodHasDepositTotals(period)) return null

  if (period.finalized_at) return period

  const nests = await listEligibleGenOwlNestsForPeriod(periodMonth)
  const counts = countEligibleByGroup(nests)
  const gen1Buckets = await countGen1EligibleByRevShareBucket(nests)
  const gen1Amounts = computeGen1RevShareBucketAmounts({
    totalSol: period.gen1_total_sol,
    totalUsdc: period.gen1_total_usdc,
    standardCount: gen1Buckets.standard,
    oneOfOneCount: gen1Buckets.one_of_one,
  })

  period = await finalizeGenOwlRevSharePeriod({
    period_month: periodMonth,
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

  return period
}
