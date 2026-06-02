import { isValidIanaTimezone, parseDateInputToUtc } from '@/lib/discord-broadcast/timezone'
import type { DiscordBroadcastScheduleType } from '@/lib/db/discord-broadcast'

export function parseScheduleDaysOfWeek(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const days = raw
    .map((d) => Number.parseInt(String(d), 10))
    .filter((d) => d >= 1 && d <= 7)
  if (days.length === 0) return null
  return [...new Set(days)].sort((a, b) => a - b)
}

export function parseLocalTimeString(raw: unknown): { hour: number; minute: number } | null {
  if (typeof raw !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim())
  if (!match) return null
  const hour = Number.parseInt(match[1]!, 10)
  const minute = Number.parseInt(match[2]!, 10)
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

export type ParsedScheduleInput =
  | {
      ok: true
      schedule_type: DiscordBroadcastScheduleType
      timezone: string
      once_at: string | null
      local_hour: number | null
      local_minute: number | null
      days_of_week: number[]
    }
  | { ok: false; error: string }

export function parseScheduleTimingInput(body: Record<string, unknown>): ParsedScheduleInput {
  const scheduleType = body.schedule_type === 'once' ? 'once' : body.schedule_type === 'recurring' ? 'recurring' : null
  if (!scheduleType) {
    return { ok: false, error: 'schedule_type must be "once" or "recurring".' }
  }

  const timezone =
    typeof body.timezone === 'string' && isValidIanaTimezone(body.timezone)
      ? body.timezone.trim()
      : null
  if (!timezone) {
    return { ok: false, error: 'A valid IANA timezone is required (e.g. America/New_York).' }
  }

  if (scheduleType === 'once') {
    const dateStr = typeof body.once_date === 'string' ? body.once_date : ''
    const time = parseLocalTimeString(body.once_time)
    if (!time) {
      return { ok: false, error: 'once_date and once_time (HH:MM) are required for one-time schedules.' }
    }
    const onceAt = parseDateInputToUtc(dateStr, time.hour, time.minute, timezone)
    if (!onceAt) {
      return { ok: false, error: 'Invalid once_date (use YYYY-MM-DD).' }
    }
    return {
      ok: true,
      schedule_type: 'once',
      timezone,
      once_at: onceAt.toISOString(),
      local_hour: null,
      local_minute: null,
      days_of_week: [1, 2, 3, 4, 5, 6, 7],
    }
  }

  const time = parseLocalTimeString(body.recurring_time)
  if (!time) {
    return { ok: false, error: 'recurring_time (HH:MM) is required for recurring schedules.' }
  }
  const days = parseScheduleDaysOfWeek(body.days_of_week)
  if (!days) {
    return { ok: false, error: 'Select at least one day of the week.' }
  }

  return {
    ok: true,
    schedule_type: 'recurring',
    timezone,
    once_at: null,
    local_hour: time.hour,
    local_minute: time.minute,
    days_of_week: days,
  }
}

export function parseOptionalIsoDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'string') return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export function parseSnoozeUntil(body: Record<string, unknown>, timezone: string): string | null {
  if (body.snooze_until === null || body.snooze_until === '') return null
  if (typeof body.snooze_until === 'string' && body.snooze_until.includes('T')) {
    return parseOptionalIsoDate(body.snooze_until)
  }
  const dateStr = typeof body.snooze_until_date === 'string' ? body.snooze_until_date : ''
  const time = parseLocalTimeString(body.snooze_until_time ?? '23:59')
  if (!dateStr || !time) return null
  const dt = parseDateInputToUtc(dateStr, time.hour, time.minute, timezone)
  return dt ? dt.toISOString() : null
}
