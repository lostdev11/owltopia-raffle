import type { Raffle } from '@/lib/types'

/**
 * When a raffle ends without selling enough tickets to meet the draw threshold, we extend the sale
 * deadline once by the raffle's original configured duration (end − start), or 7 days if that span
 * is invalid. Policy: at most one extension (`MAX_MIN_THRESHOLD_TIME_EXTENSIONS` in ticket-escrow-policy).
 */
export type MinThresholdMissExtensionPatch = {
  original_end_time: string
  end_time: string
  status: 'live'
  is_active: boolean
  time_extension_count: number
}

/**
 * Fields to pass to `updateRaffle` when min tickets were not met at `end_time` and an extension is allowed.
 * Callers must still check {@link hasExhaustedMinThresholdTimeExtensions} before applying.
 */
export function buildMinThresholdMissExtensionPatch(
  raffle: Pick<Raffle, 'start_time' | 'end_time' | 'original_end_time' | 'time_extension_count'>
): MinThresholdMissExtensionPatch {
  const originalEndTime = raffle.original_end_time || raffle.end_time
  const startTimeMs = new Date(raffle.start_time).getTime()
  const originalEndMs = new Date(originalEndTime).getTime()
  const baseDurationMs = originalEndMs - startTimeMs
  const durationMs =
    baseDurationMs > 0 ? baseDurationMs : 7 * 24 * 60 * 60 * 1000

  const currentEndMs = new Date(raffle.end_time).getTime()
  const newEndTime = new Date(currentEndMs + durationMs)

  return {
    original_end_time: originalEndTime,
    end_time: newEndTime.toISOString(),
    status: 'live',
    is_active: true,
    time_extension_count: (raffle.time_extension_count ?? 0) + 1,
  }
}
