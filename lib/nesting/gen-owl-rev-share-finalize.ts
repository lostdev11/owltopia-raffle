import {
  finalizeGenOwlRevSharePeriod,
  getGenOwlRevSharePeriod,
  upsertGenOwlRevSharePeriodTotals,
  type GenOwlRevSharePeriodRow,
} from '@/lib/db/gen-owl-rev-share-periods'
import { getRevShareSchedule } from '@/lib/db/rev-share-schedule'
import { computeEvenRevSharePerNest } from '@/lib/nesting/gen-owl-rev-share'
import {
  countEligibleByGroup,
  listEligibleGenOwlNestsForPeriod,
} from '@/lib/nesting/gen-owl-rev-share-eligibility'
import { claimsOpenForPeriod } from '@/lib/nesting/gen-owl-rev-share-month'

/** Ensure a period row exists (from schedule template if missing). */
export async function ensureGenOwlRevSharePeriodRow(periodMonth: string): Promise<GenOwlRevSharePeriodRow | null> {
  const existing = await getGenOwlRevSharePeriod(periodMonth)
  if (existing) return existing

  const schedule = await getRevShareSchedule()
  if (!schedule) return null

  return upsertGenOwlRevSharePeriodTotals({
    period_month: periodMonth,
    gen1_total_sol: schedule.gen1_total_sol,
    gen1_total_usdc: schedule.gen1_total_usdc,
    gen2_total_sol: schedule.gen2_total_sol,
    gen2_total_usdc: schedule.gen2_total_usdc,
  })
}

/** Snapshot eligible nest counts and per-nest amounts when claims open. */
export async function ensureGenOwlRevSharePeriodFinalized(
  periodMonth: string
): Promise<GenOwlRevSharePeriodRow | null> {
  if (!claimsOpenForPeriod(periodMonth)) return null

  let period = await ensureGenOwlRevSharePeriodRow(periodMonth)
  if (!period) return null

  if (period.finalized_at) return period

  const nests = await listEligibleGenOwlNestsForPeriod(periodMonth)
  const counts = countEligibleByGroup(nests)

  period = await finalizeGenOwlRevSharePeriod({
    period_month: periodMonth,
    gen1_eligible_count: counts['gen1-owl'],
    gen2_eligible_count: counts['gen2-owl'],
    gen1_per_nest_sol: computeEvenRevSharePerNest(period.gen1_total_sol, counts['gen1-owl']),
    gen1_per_nest_usdc: computeEvenRevSharePerNest(period.gen1_total_usdc, counts['gen1-owl']),
    gen2_per_nest_sol: computeEvenRevSharePerNest(period.gen2_total_sol, counts['gen2-owl']),
    gen2_per_nest_usdc: computeEvenRevSharePerNest(period.gen2_total_usdc, counts['gen2-owl']),
  })

  return period
}
