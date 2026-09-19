import {
  clearGenOwlRevSharePeriodFinalization,
  finalizeGenOwlRevSharePeriod,
  getGenOwlRevSharePeriod,
  type GenOwlRevSharePeriodRow,
} from '@/lib/db/gen-owl-rev-share-periods'
import {
  deleteGenOwlRevShareEligibleNestsForPeriod,
  replaceGenOwlRevShareEligibleNestsForPeriod,
  type GenOwlRevShareEligibleNestInsert,
} from '@/lib/db/gen-owl-rev-share-eligible-nests'
import { countActiveGenOwlNestsByGroup } from '@/lib/db/gen-owl-rev-share-stats'
import { computeGenOwlRevShareBucketAmounts } from '@/lib/nesting/gen-owl-rev-share'
import {
  countEligibleByGroup,
  listEligibleGenOwlNestsForPeriod,
  type GenOwlEligibleNest,
} from '@/lib/nesting/gen-owl-rev-share-eligibility'
import { classifyGen1OneOfOneMints } from '@/lib/nesting/gen1-one-of-one'
import { classifyGen2OneOfOneMints } from '@/lib/nesting/gen2-one-of-one'
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

/** Classify eligible nests once — same buckets drive rates and the claim snapshot. */
async function buildEligibleNestSnapshot(
  nests: GenOwlEligibleNest[],
  periodMonth: string
): Promise<{
  rows: GenOwlRevShareEligibleNestInsert[]
  gen1: { standard: number; one_of_one: number }
  gen2: { standard: number; one_of_one: number }
}> {
  const gen1Mints = nests
    .filter((n) => n.group === 'gen1-owl')
    .map((n) => n.position.asset_identifier?.trim())
    .filter((m): m is string => Boolean(m))
  const gen2Mints = nests
    .filter((n) => n.group === 'gen2-owl')
    .map((n) => n.position.asset_identifier?.trim())
    .filter((m): m is string => Boolean(m))

  const [gen1Class, gen2Class] = await Promise.all([
    classifyGen1OneOfOneMints(gen1Mints),
    classifyGen2OneOfOneMints(gen2Mints),
  ])

  const rows: GenOwlRevShareEligibleNestInsert[] = []
  let gen1Standard = 0
  let gen1Ooo = 0
  let gen2Standard = 0
  let gen2Ooo = 0

  for (const nest of nests) {
    const mint = nest.position.asset_identifier?.trim() || null
    const classification = nest.group === 'gen1-owl' ? gen1Class : gen2Class
    const bucket =
      mint && classification.get(mint) === 'one-of-one' ? ('one-of-one' as const) : ('standard' as const)

    if (nest.group === 'gen1-owl') {
      if (bucket === 'one-of-one') gen1Ooo++
      else gen1Standard++
    } else if (bucket === 'one-of-one') {
      gen2Ooo++
    } else {
      gen2Standard++
    }

    rows.push({
      period_month: periodMonth,
      position_id: nest.position.id,
      wallet_address: nest.position.wallet_address,
      asset_identifier: mint,
      group_key: nest.group,
      bucket,
    })
  }

  return {
    rows,
    gen1: { standard: gen1Standard, one_of_one: gen1Ooo },
    gen2: { standard: gen2Standard, one_of_one: gen2Ooo },
  }
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

  const snapshot = await buildEligibleNestSnapshot(nests, period.period_month)
  const gen1Amounts = computeGenOwlRevShareBucketAmounts({
    totalSol: period.gen1_total_sol,
    totalUsdc: period.gen1_total_usdc,
    standardCount: snapshot.gen1.standard,
    oneOfOneCount: snapshot.gen1.one_of_one,
  })
  const gen2Amounts = computeGenOwlRevShareBucketAmounts({
    totalSol: period.gen2_total_sol,
    totalUsdc: period.gen2_total_usdc,
    standardCount: snapshot.gen2.standard,
    oneOfOneCount: snapshot.gen2.one_of_one,
  })

  // Persist nest→bucket before rates so claims never reclassify against a different set.
  await replaceGenOwlRevShareEligibleNestsForPeriod(period.period_month, snapshot.rows)

  const finalized = await finalizeGenOwlRevSharePeriod({
    period_month: period.period_month,
    gen1_eligible_count: counts['gen1-owl'],
    gen2_eligible_count: counts['gen2-owl'],
    gen1_standard_eligible_count: gen1Amounts.standard_count,
    gen1_one_of_one_eligible_count: gen1Amounts.one_of_one_count,
    gen2_standard_eligible_count: gen2Amounts.standard_count,
    gen2_one_of_one_eligible_count: gen2Amounts.one_of_one_count,
    gen1_per_nest_sol: gen1Amounts.standard_per_nest_sol,
    gen1_per_nest_usdc: gen1Amounts.standard_per_nest_usdc,
    gen1_standard_per_nest_sol: gen1Amounts.standard_per_nest_sol,
    gen1_standard_per_nest_usdc: gen1Amounts.standard_per_nest_usdc,
    gen1_one_of_one_per_nest_sol: gen1Amounts.one_of_one_per_nest_sol,
    gen1_one_of_one_per_nest_usdc: gen1Amounts.one_of_one_per_nest_usdc,
    gen2_per_nest_sol: gen2Amounts.standard_per_nest_sol,
    gen2_per_nest_usdc: gen2Amounts.standard_per_nest_usdc,
    gen2_standard_per_nest_sol: gen2Amounts.standard_per_nest_sol,
    gen2_standard_per_nest_usdc: gen2Amounts.standard_per_nest_usdc,
    gen2_one_of_one_per_nest_sol: gen2Amounts.one_of_one_per_nest_sol,
    gen2_one_of_one_per_nest_usdc: gen2Amounts.one_of_one_per_nest_usdc,
  })

  if (!finalized) {
    // Avoid orphan snapshot without rates.
    await deleteGenOwlRevShareEligibleNestsForPeriod(period.period_month).catch(() => {})
  }
  return finalized
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
    await deleteGenOwlRevShareEligibleNestsForPeriod(periodMonth).catch(() => {})
    period = await clearGenOwlRevSharePeriodFinalization(periodMonth)
    if (!period) return null
  }

  return computeAndWriteFinalize(period)
}
