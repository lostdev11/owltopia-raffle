import type { Raffle } from '@/lib/types'

/** Raffles admins may promote to Discord as “still live” (tickets may still be open). */
export function isRaffleLiveForManualDiscordShare(r: Raffle, nowMs: number = Date.now()): boolean {
  if (!r.is_active) return false
  const st = (r.status ?? '').toLowerCase()
  if (
    st === 'cancelled' ||
    st === 'completed' ||
    st === 'successful_pending_claims' ||
    st === 'failed_refund_available'
  ) {
    return false
  }
  const end = new Date(r.end_time).getTime()
  return Number.isFinite(end) && end > nowMs
}
