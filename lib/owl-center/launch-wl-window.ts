import {
  getActivePartnerAllowlistPhase,
  isPartnerAllowlistWaiting,
  isPartnerAllowlistWindowOpen,
  partnerAllowlistEarliestStart,
  resolvePartnerAllowlistPhases,
  type PartnerAllowlistPhase,
} from '@/lib/owl-center/partner-allowlist-phases'
import { formatMintDate } from '@/lib/owl-center/phase-schedule'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

export type { PartnerAllowlistPhase }

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** Partner collection has a whitelist / allowlist program configured. */
export function launchHasWhitelistProgram(
  launch: Pick<
    OwlCenterLaunchPublic,
    'creator_wl_enabled' | 'wl_supply' | 'partner_allowlist_phases'
  >
): boolean {
  if (resolvePartnerAllowlistPhases(launch).length > 0) return true
  return Boolean(launch.creator_wl_enabled) || Number(launch.wl_supply ?? 0) > 0
}

/**
 * True when a scheduled PUBLIC start time has been reached.
 * Ignores active_phases — partner go-live often sets PUBLIC live while
 * phase_schedule.PUBLIC is still in the future.
 */
export function isScheduledPhaseStartReached(
  launch: Pick<OwlCenterLaunchPublic, 'launch_deadline_at' | 'phase_schedule'>,
  phase: 'WHITELIST' | 'PUBLIC',
  nowMs: number = Date.now()
): boolean {
  if (phase === 'PUBLIC') {
    const startMs = parseIsoMs(launch.phase_schedule?.PUBLIC)
    if (startMs == null) return false
    return nowMs >= startMs
  }
  const phases = resolvePartnerAllowlistPhases(
    launch as Pick<
      OwlCenterLaunchPublic,
      | 'partner_allowlist_phases'
      | 'creator_wl_enabled'
      | 'wl_supply'
      | 'wl_price_usdc'
      | 'phase_schedule'
    >
  )
  const earliest = partnerAllowlistEarliestStart(phases)
  const startMs = parseIsoMs(earliest)
  if (startMs == null) return false
  return nowMs >= startMs
}

/** Allowlist configured and earliest phase start is still in the future. */
export function isLaunchWaitingForWhitelist(
  launch: Pick<
    OwlCenterLaunchPublic,
    | 'creator_wl_enabled'
    | 'wl_supply'
    | 'wl_price_usdc'
    | 'partner_allowlist_phases'
    | 'phase_schedule'
    | 'launch_deadline_at'
    | 'is_paused'
  >,
  nowMs: number = Date.now()
): boolean {
  return isPartnerAllowlistWaiting(launch, nowMs)
}

/**
 * Early allowlist window: an allowlist phase has started and PUBLIC has not.
 * Soft-gated via owl_center_launch_wl_wallets for the active phase_key.
 */
export function isLaunchWhitelistWindowOpen(
  launch: Pick<
    OwlCenterLaunchPublic,
    | 'creator_wl_enabled'
    | 'wl_supply'
    | 'wl_price_usdc'
    | 'partner_allowlist_phases'
    | 'phase_schedule'
    | 'launch_deadline_at'
    | 'is_paused'
  >,
  nowMs: number = Date.now()
): boolean {
  return isPartnerAllowlistWindowOpen(launch, nowMs)
}

export function getLaunchActiveAllowlistPhase(
  launch: Pick<
    OwlCenterLaunchPublic,
    | 'creator_wl_enabled'
    | 'wl_supply'
    | 'wl_price_usdc'
    | 'partner_allowlist_phases'
    | 'phase_schedule'
    | 'launch_deadline_at'
    | 'is_paused'
  >,
  nowMs: number = Date.now()
): PartnerAllowlistPhase | null {
  return getActivePartnerAllowlistPhase(launch, nowMs)
}

export function formatAllowlistOpensReason(
  launch: Pick<
    OwlCenterLaunchPublic,
    | 'creator_wl_enabled'
    | 'wl_supply'
    | 'wl_price_usdc'
    | 'partner_allowlist_phases'
    | 'phase_schedule'
  >
): string {
  const phases = resolvePartnerAllowlistPhases(launch)
  const earliest = partnerAllowlistEarliestStart(phases)
  if (earliest) {
    const first = phases.find((p) => p.starts_at === earliest)
    const label = first?.label ?? 'Allowlist'
    return `${label} opens ${formatMintDate(earliest)}`
  }
  return 'Allowlist has not opened yet'
}
