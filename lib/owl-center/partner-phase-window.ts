/**
 * Partner allowlist phase windows: ends_at, concurrent_with_public, legacy sequential behavior.
 */

import {
  resolveEffectivePartnerAllowlistPhases,
  type PartnerAllowlistPhase,
} from '@/lib/owl-center/partner-allowlist-phases'

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : null
}

type WindowLaunch = {
  partner_allowlist_phases?: PartnerAllowlistPhase[] | null
  creator_wl_enabled?: boolean
  wl_supply?: number
  wl_price_usdc?: number | null
  phase_schedule?: Partial<Record<string, string>>
  launch_deadline_at?: string | null
  is_paused?: boolean
}

/**
 * Guard plan / schedule end for an allowlist phase.
 * - Explicit `ends_at` wins.
 * - Open-ended + `concurrent_with_public` → null (stays open after public).
 * - Legacy (no ends_at, not concurrent) → next phase start or public start.
 */
export function resolvePartnerAllowlistPhaseEndDateIso(
  phase: PartnerAllowlistPhase,
  phaseIndex: number,
  allPhases: PartnerAllowlistPhase[],
  publicStartsAt: string | null
): string | null {
  if (phase.ends_at?.trim()) return new Date(phase.ends_at).toISOString()
  if (phase.concurrent_with_public) return null
  const next = allPhases[phaseIndex + 1]
  return next?.starts_at ?? publicStartsAt
}

/** Whether this allowlist phase window is open at `nowMs` (ignores wallet eligibility). */
export function isPartnerAllowlistPhaseWindowOpen(
  phase: PartnerAllowlistPhase,
  phaseIndex: number,
  launch: WindowLaunch,
  nowMs: number = Date.now()
): boolean {
  if (launch.is_paused) return false
  const startMs = parseIsoMs(phase.starts_at)
  if (startMs == null || nowMs < startMs) return false

  const phases = resolveEffectivePartnerAllowlistPhases(launch)
  const publicStarts = launch.phase_schedule?.PUBLIC ?? null
  const endIso = resolvePartnerAllowlistPhaseEndDateIso(phase, phaseIndex, phases, publicStarts)
  const endMs = parseIsoMs(endIso)
  if (endMs != null && nowMs >= endMs) return false

  const publicMs = parseIsoMs(publicStarts)
  if (
    !phase.concurrent_with_public &&
    !phase.ends_at?.trim() &&
    publicMs != null &&
    nowMs >= publicMs
  ) {
    return false
  }

  return true
}

/** All allowlist phases whose windows are open at `nowMs`. */
export function listOpenPartnerAllowlistPhases(
  launch: WindowLaunch,
  nowMs: number = Date.now()
): Array<{ phase: PartnerAllowlistPhase; index: number }> {
  const phases = resolveEffectivePartnerAllowlistPhases(launch).filter((p) => p.starts_at)
  const open: Array<{ phase: PartnerAllowlistPhase; index: number }> = []
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i]!
    if (isPartnerAllowlistPhaseWindowOpen(phase, i, launch, nowMs)) {
      open.push({ phase, index: i })
    }
  }
  return open
}

export function isScheduledPublicMintOpen(
  launch: Pick<WindowLaunch, 'phase_schedule' | 'is_paused'>,
  nowMs: number = Date.now()
): boolean {
  if (launch.is_paused) return false
  const publicMs = parseIsoMs(launch.phase_schedule?.PUBLIC)
  if (publicMs == null) return true
  return nowMs >= publicMs
}
