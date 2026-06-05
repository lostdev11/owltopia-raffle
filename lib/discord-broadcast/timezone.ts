/** IANA timezone helpers for Discord broadcast scheduling (client + server). */

export type LocalTimeParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  /** ISO weekday: 1 = Monday … 7 = Sunday */
  isoWeekday: number
}

const WEEKDAY_TO_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
}

export function isValidIanaTimezone(tz: string): boolean {
  const trimmed = tz.trim()
  if (!trimmed) return false
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed })
    return true
  } catch {
    return false
  }
}

export function getDefaultBrowserTimezone(): string {
  if (typeof Intl === 'undefined') return 'UTC'
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function parseNumericPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const p = parts.find((x) => x.type === type)
  return p ? Number.parseInt(p.value, 10) : 0
}

export function getLocalTimeParts(date: Date, timezone: string): LocalTimeParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  })
  const parts = fmt.formatToParts(date)
  const weekdayShort = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon'
  return {
    year: parseNumericPart(parts, 'year'),
    month: parseNumericPart(parts, 'month'),
    day: parseNumericPart(parts, 'day'),
    hour: parseNumericPart(parts, 'hour') % 24,
    minute: parseNumericPart(parts, 'minute'),
    isoWeekday: WEEKDAY_TO_ISO[weekdayShort] ?? 1,
  }
}

export function formatDateTimeInTimezone(
  date: Date | string,
  timezone: string,
  opts?: { includeTimezoneLabel?: boolean }
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const formatted = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
  if (opts?.includeTimezoneLabel) {
    return `${formatted} (${timezone})`
  }
  return formatted
}

/**
 * Convert a wall-clock time in `timezone` to UTC Date.
 */
export function zonedLocalDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
): Date {
  if (!isValidIanaTimezone(timezone)) {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))
  }

  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  for (let offsetMin = -18 * 60; offsetMin <= 18 * 60; offsetMin++) {
    const candidate = new Date(naiveUtc + offsetMin * 60_000)
    const local = getLocalTimeParts(candidate, timezone)
    if (
      local.year === year &&
      local.month === month &&
      local.day === day &&
      local.hour === hour &&
      local.minute === minute
    ) {
      return candidate
    }
  }

  return new Date(naiveUtc)
}

export function parseDateInputToUtc(
  dateStr: string,
  hour: number,
  minute: number,
  timezone: string
): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!match) return null
  const year = Number.parseInt(match[1]!, 10)
  const month = Number.parseInt(match[2]!, 10)
  const day = Number.parseInt(match[3]!, 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return zonedLocalDateTimeToUtc(year, month, day, hour, minute, timezone)
}

export function localDateStringInTimezone(date: Date, timezone: string): string {
  const p = getLocalTimeParts(date, timezone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

export function computeNextRecurringRunUtc(
  schedule: {
    timezone: string
    local_hour: number
    local_minute: number
    days_of_week: number[]
  },
  after: Date = new Date()
): Date | null {
  if (!isValidIanaTimezone(schedule.timezone)) return null
  const days = schedule.days_of_week.length ? schedule.days_of_week : [1, 2, 3, 4, 5, 6, 7]

  const start = new Date(after.getTime() + 60_000)
  for (let dayOffset = 0; dayOffset < 370; dayOffset++) {
    const probe = new Date(start.getTime() + dayOffset * 86_400_000)
    const local = getLocalTimeParts(probe, schedule.timezone)
    if (!days.includes(local.isoWeekday)) continue

    const runAt = zonedLocalDateTimeToUtc(
      local.year,
      local.month,
      local.day,
      schedule.local_hour,
      schedule.local_minute,
      schedule.timezone
    )
    if (runAt.getTime() > after.getTime()) {
      return runAt
    }
  }
  return null
}

export const ISO_WEEKDAY_LABELS: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
]
