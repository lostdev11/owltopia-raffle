/**
 * Client-safe publish timing helpers (no DB / server imports).
 */

/**
 * After deposits are confirmed: `live` if start_time has arrived, otherwise keep `draft`
 * with `is_active` so Future Raffles can show it until `promoteDraftRafflesToLive`.
 */
export function publicationStatusForStartTime(
  startTime: string | null | undefined,
  nowMs: number = Date.now()
): 'live' | 'draft' {
  const raw = typeof startTime === 'string' ? startTime.trim() : ''
  if (!raw) return 'live'
  const startMs = new Date(raw).getTime()
  if (!Number.isFinite(startMs)) return 'live'
  return startMs > nowMs ? 'draft' : 'live'
}
