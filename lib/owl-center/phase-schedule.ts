import { owlCenterPhaseLabel } from '@/lib/owl-center/phase-display'
import type { OwlCenterLaunchPublic, OwlCenterPhase } from '@/lib/owl-center/types'

/** Phases that can appear on a mint schedule (excludes SOLD_OUT). */
export const OWL_CENTER_SCHEDULED_PHASES: OwlCenterPhase[] = [
  'AIRDROP',
  'PRESALE',
  'PRESALE_OVERAGE',
  'WHITELIST',
  'PUBLIC',
  'TRADING_ACTIVE',
]

export type OwlCenterPhaseSchedule = Partial<Record<OwlCenterPhase, string>>

/** Phases that can actually be minted (excludes terminal SOLD_OUT / TRADING_ACTIVE). */
export const OWL_CENTER_MINTABLE_PHASES: OwlCenterPhase[] = [
  'AIRDROP',
  'PRESALE',
  'PRESALE_OVERAGE',
  'WHITELIST',
  'PUBLIC',
]

/** Normalize DB jsonb / API body into a validated list of concurrent active phases. */
export function parseActivePhases(raw: unknown): OwlCenterPhase[] {
  if (!Array.isArray(raw)) return []
  const out: OwlCenterPhase[] = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const p = v.toUpperCase() as OwlCenterPhase
    if (OWL_CENTER_MINTABLE_PHASES.includes(p) && !out.includes(p)) out.push(p)
  }
  return out
}

/**
 * The set of phases that are mintable RIGHT NOW. Used as the coarse "is this phase allowed" gate
 * across eligibility, the public mint UI, and the server mint endpoints. Fine-grained per-wallet
 * eligibility (allocation, pool caps, schedule) is still computed separately per phase.
 *
 * Live set = the primary `active_phase` (back-compat) ∪ admin-toggled `active_phases` ∪ the Gen1
 * 7-day airdrop window. Terminal phases (SOLD_OUT / TRADING_ACTIVE) close the mint entirely.
 */
export function getLivePhases(
  launch: Pick<OwlCenterLaunchPublic, 'active_phase' | 'active_phases' | 'launch_deadline_at' | 'phase_schedule'>,
  nowMs: number = Date.now()
): Set<OwlCenterPhase> {
  const live = new Set<OwlCenterPhase>()
  if (launch.active_phase === 'SOLD_OUT' || launch.active_phase === 'TRADING_ACTIVE') return live
  if (OWL_CENTER_MINTABLE_PHASES.includes(launch.active_phase)) live.add(launch.active_phase)
  for (const p of launch.active_phases ?? []) {
    if (OWL_CENTER_MINTABLE_PHASES.includes(p)) live.add(p)
  }
  if (isGen1AirdropWindowOpen(launch, nowMs)) live.add('AIRDROP')
  return live
}

/** True when a phase is in the live set (admin-active or the primary/Gen1-window phase). */
export function isPhaseLive(
  launch: Pick<OwlCenterLaunchPublic, 'active_phase' | 'active_phases' | 'launch_deadline_at' | 'phase_schedule'>,
  phase: OwlCenterPhase,
  nowMs: number = Date.now()
): boolean {
  return getLivePhases(launch, nowMs).has(phase)
}

export type MintCountdownInfo = {
  target_at: string
  label: string
  phase: OwlCenterPhase | 'MINT'
}

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** Normalize DB jsonb / API body into a validated phase schedule map. */
export function parsePhaseSchedule(raw: unknown): OwlCenterPhaseSchedule {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: OwlCenterPhaseSchedule = {}
  for (const phase of OWL_CENTER_SCHEDULED_PHASES) {
    const v = (raw as Record<string, unknown>)[phase]
    if (typeof v !== 'string' || !v.trim()) continue
    const ms = parseIsoMs(v)
    if (ms != null) out[phase] = new Date(ms).toISOString()
  }
  return out
}

/** When a phase opens: explicit schedule entry, else mint kickoff for AIRDROP only. */
export function getPhaseStartsAt(
  launch: Pick<OwlCenterLaunchPublic, 'launch_deadline_at' | 'phase_schedule'>,
  phase: OwlCenterPhase
): string | null {
  const scheduled = launch.phase_schedule?.[phase]
  if (scheduled) return scheduled
  if (phase === 'AIRDROP' && launch.launch_deadline_at) return launch.launch_deadline_at
  return null
}

export function isPhaseOpenBySchedule(
  launch: Pick<OwlCenterLaunchPublic, 'launch_deadline_at' | 'phase_schedule'> &
    Partial<Pick<OwlCenterLaunchPublic, 'active_phases'>>,
  phase: OwlCenterPhase,
  nowMs: number = Date.now()
): boolean {
  // An explicitly admin-activated concurrent phase is open now, regardless of its scheduled time.
  if (launch.active_phases?.includes(phase)) return true
  const startsAt = getPhaseStartsAt(launch, phase)
  if (!startsAt) return true
  const startMs = parseIsoMs(startsAt)
  if (startMs == null) return true
  return nowMs >= startMs
}

/**
 * Legacy fixed window from AIRDROP kickoff (used when no concurrent paid phase is admin-active).
 * Gen1 + presale free redemption stay open while PRESALE / PUBLIC (etc.) are in `active_phases`;
 * per-wallet caps are enforced by the cosigner + confirm RPC, not by this clock.
 */
export const GEN1_AIRDROP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const GEN1_CONCURRENT_BACKSTOP_PHASES: ReadonlySet<OwlCenterPhase> = new Set([
  'PRESALE',
  'PRESALE_OVERAGE',
  'WHITELIST',
  'PUBLIC',
])

export function isGen1AirdropWindowOpen(
  launch: Pick<OwlCenterLaunchPublic, 'launch_deadline_at' | 'phase_schedule' | 'active_phases'>,
  nowMs: number = Date.now()
): boolean {
  if (launch.active_phases?.includes('AIRDROP')) return true
  if (launch.active_phases?.some((p) => GEN1_CONCURRENT_BACKSTOP_PHASES.has(p))) return true
  const startMs = parseIsoMs(getPhaseStartsAt(launch, 'AIRDROP'))
  if (startMs == null) return false
  return nowMs >= startMs && nowMs <= startMs + GEN1_AIRDROP_WINDOW_MS
}

/** Next future milestone for countdown UI (mint kickoff or next scheduled phase). */
export function getMintCountdownInfo(
  launch: Pick<OwlCenterLaunchPublic, 'launch_deadline_at' | 'phase_schedule' | 'active_phase'>,
  nowMs: number = Date.now()
): MintCountdownInfo | null {
  const kickoffMs = parseIsoMs(launch.launch_deadline_at)
  if (kickoffMs != null && nowMs < kickoffMs) {
    return {
      target_at: launch.launch_deadline_at!,
      label: 'Mint opens in',
      phase: 'MINT',
    }
  }

  for (const phase of OWL_CENTER_SCHEDULED_PHASES) {
    const startsAt = launch.phase_schedule?.[phase]
    const startMs = parseIsoMs(startsAt)
    if (startMs == null || startMs <= nowMs) continue
    return {
      target_at: startsAt!,
      label: `${owlCenterPhaseLabel(phase)} opens in`,
      phase,
    }
  }

  return null
}

export function formatMintDate(iso: string | null | undefined): string {
  if (!iso) return 'TBA'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'TBA'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatPhaseStartShort(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Convert `<input type="datetime-local">` value to ISO (local → UTC). */
export function datetimeLocalToIso(local: string): string | null {
  const trimmed = local.trim()
  if (!trimmed) return null
  const d = new Date(trimmed)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/** Format ISO for datetime-local input in local timezone. */
export function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
