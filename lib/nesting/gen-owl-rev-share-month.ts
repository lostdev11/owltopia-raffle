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

/** Claims open at 00:00:00 UTC on the 1st of the month after `periodMonth`. */
export function claimsOpenAtUtc(periodMonth: string): Date | null {
  const parsed = parsePeriodMonth(periodMonth)
  if (!parsed) return null
  return new Date(Date.UTC(parsed.year, parsed.month, 1, 0, 0, 0, 0))
}

export function claimsOpenForPeriod(periodMonth: string, now = new Date()): boolean {
  const openAt = claimsOpenAtUtc(periodMonth)
  return openAt != null && now.getTime() >= openAt.getTime()
}

/** Most recently completed month whose claim window is open (if any). */
export function latestOpenClaimPeriodMonth(now = new Date()): string | null {
  const current = formatPeriodMonthUtc(now)
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

export function groupKeyForPoolSlug(slug: string | null | undefined): GenOwlStakingGroupKey | null {
  const s = slug?.trim().toLowerCase() ?? ''
  if (s.startsWith('gen1-owl')) return 'gen1-owl'
  if (s.startsWith('gen2-owl')) return 'gen2-owl'
  return null
}
