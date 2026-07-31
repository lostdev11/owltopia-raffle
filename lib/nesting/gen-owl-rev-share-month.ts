import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'

const PERIOD_RE = /^(\d{4})-(\d{2})$/

/** Calendar month key `YYYY-MM` (UTC). */
export function formatPeriodMonthUtc(date: Date): string {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

export function parsePeriodMonth(periodMonth: string): { year: number; month: number } | null {
  const m = periodMonth.trim().match(PERIOD_RE)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null
  return { year, month }
}

/** UTC instant: last ms of the given calendar month. */
export function endOfPeriodMonthUtc(periodMonth: string): Date | null {
  const parsed = parsePeriodMonth(periodMonth)
  if (!parsed) return null
  return new Date(Date.UTC(parsed.year, parsed.month, 0, 23, 59, 59, 999))
}

/**
 * Claims open at 00:00:00 UTC on the last calendar day of `periodMonth`
 * (e.g. July period → 31 July 00:00 UTC), matching the homepage payout date.
 */
export function claimsOpenAtUtc(periodMonth: string): Date | null {
  const parsed = parsePeriodMonth(periodMonth)
  if (!parsed) return null
  // Day 0 of next month = last day of period month
  const lastDay = new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate()
  return new Date(Date.UTC(parsed.year, parsed.month - 1, lastDay, 0, 0, 0, 0))
}

export function claimsOpenForPeriod(periodMonth: string, now = new Date()): boolean {
  const openAt = claimsOpenAtUtc(periodMonth)
  return openAt != null && now.getTime() >= openAt.getTime()
}

/** Most recently completed (or currently claimable) month whose claim window is open. */
export function latestOpenClaimPeriodMonth(now = new Date()): string | null {
  const current = formatPeriodMonthUtc(now)
  if (claimsOpenForPeriod(current, now)) return current
  const parsed = parsePeriodMonth(current)
  if (!parsed) return null
  const prevMonthDate = new Date(Date.UTC(parsed.year, parsed.month - 1, 1))
  const prev = formatPeriodMonthUtc(prevMonthDate)
  return claimsOpenForPeriod(prev, now) ? prev : null
}

/** Human label e.g. "June 2026". */
export function formatPeriodMonthLabel(periodMonth: string): string {
  const parsed = parsePeriodMonth(periodMonth)
  if (!parsed) return periodMonth
  return new Date(Date.UTC(parsed.year, parsed.month - 1, 15)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Map homepage schedule date strings (e.g. "31 August 2026", "31 Aug 2026", "2026-08")
 * to a period month key. Returns null when unparseable.
 */
export function periodMonthFromScheduleDate(raw: string | null | undefined): string | null {
  const s = raw?.trim()
  if (!s) return null
  if (PERIOD_RE.test(s)) return s

  // "31 August 2026" / "31 Aug 2026" / "August 31, 2026"
  const named = s.match(
    /^(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{4})$/i
  )
  if (named) {
    const day = Number(named[1])
    const year = Number(named[3])
    const monthToken = named[2].toLowerCase()
    const monthMap: Record<string, number> = {
      january: 1,
      jan: 1,
      february: 2,
      feb: 2,
      march: 3,
      mar: 3,
      april: 4,
      apr: 4,
      may: 5,
      june: 6,
      jun: 6,
      july: 7,
      jul: 7,
      august: 8,
      aug: 8,
      september: 9,
      sept: 9,
      sep: 9,
      october: 10,
      oct: 10,
      november: 11,
      nov: 11,
      december: 12,
      dec: 12,
    }
    const month = monthMap[monthToken]
    if (month && day >= 1 && day <= 31 && year >= 2000) {
      return `${year}-${String(month).padStart(2, '0')}`
    }
  }

  const parsed = Date.parse(s)
  if (!Number.isNaN(parsed)) {
    return formatPeriodMonthUtc(new Date(parsed))
  }
  return null
}

/**
 * Whether homepage schedule pool totals for a gen should feed the given period's estimate.
 * Future-month schedule amounts (e.g. Gen 2 → August) must not appear under the current month.
 */
export function scheduleTotalsApplyToPeriod(
  nextDate: string | null | undefined,
  periodMonth: string
): boolean {
  const fromDate = periodMonthFromScheduleDate(nextDate)
  if (!fromDate) return true
  return fromDate === periodMonth
}

export function groupKeyForPoolSlug(slug: string | null | undefined): GenOwlStakingGroupKey | null {
  const s = slug?.trim().toLowerCase() ?? ''
  if (s.startsWith('gen1-owl')) return 'gen1-owl'
  if (s.startsWith('gen2-owl')) return 'gen2-owl'
  return null
}
