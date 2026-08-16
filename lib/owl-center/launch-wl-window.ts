import { getPhaseStartsAt } from '@/lib/owl-center/phase-schedule'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** Partner collection has a whitelist program configured. */
export function launchHasWhitelistProgram(
  launch: Pick<OwlCenterLaunchPublic, 'creator_wl_enabled' | 'wl_supply'>
): boolean {
  return Boolean(launch.creator_wl_enabled) || Number(launch.wl_supply ?? 0) > 0
}

/**
 * True when a scheduled phase start time has been reached.
 * Unlike isPhaseOpenBySchedule, ignores active_phases — partner go-live often sets
 * PUBLIC live while phase_schedule.PUBLIC is still in the future.
 */
export function isScheduledPhaseStartReached(
  launch: Pick<OwlCenterLaunchPublic, 'launch_deadline_at' | 'phase_schedule'>,
  phase: 'WHITELIST' | 'PUBLIC',
  nowMs: number = Date.now()
): boolean {
  const startsAt = getPhaseStartsAt(launch, phase)
  const startMs = parseIsoMs(startsAt)
  if (startMs == null) return false
  return nowMs >= startMs
}

/** WL configured and WL start is still in the future. */
export function isLaunchWaitingForWhitelist(
  launch: Pick<
    OwlCenterLaunchPublic,
    'creator_wl_enabled' | 'wl_supply' | 'phase_schedule' | 'launch_deadline_at' | 'is_paused'
  >,
  nowMs: number = Date.now()
): boolean {
  if (launch.is_paused) return false
  if (!launchHasWhitelistProgram(launch)) return false
  const wlStart = getPhaseStartsAt(launch, 'WHITELIST')
  const wlMs = parseIsoMs(wlStart)
  if (wlMs == null) return false
  return nowMs < wlMs
}

/**
 * Early WL window for public_simple partner launches: WL schedule has started,
 * public mint schedule has not opened yet. Soft-gated via owl_center_launch_wl_wallets.
 *
 * If PUBLIC has no schedule entry, the WL window stays open after WL start
 * (only listed wallets can mint until a public start is set).
 */
export function isLaunchWhitelistWindowOpen(
  launch: Pick<
    OwlCenterLaunchPublic,
    | 'creator_wl_enabled'
    | 'wl_supply'
    | 'phase_schedule'
    | 'launch_deadline_at'
    | 'is_paused'
  >,
  nowMs: number = Date.now()
): boolean {
  if (launch.is_paused) return false
  if (!launchHasWhitelistProgram(launch)) return false
  if (!isScheduledPhaseStartReached(launch, 'WHITELIST', nowMs)) return false
  // Public open ends the early WL window (schedule only — not active_phases).
  if (isScheduledPhaseStartReached(launch, 'PUBLIC', nowMs)) return false
  return true
}
