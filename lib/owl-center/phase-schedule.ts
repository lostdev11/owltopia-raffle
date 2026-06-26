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
  launch: Pick<OwlCenterLaunchPublic, 'launch_deadline_at' | 'phase_schedule'>,
  phase: OwlCenterPhase,
  nowMs: number = Date.now()
): boolean {
  const startsAt = getPhaseStartsAt(launch, phase)
  if (!startsAt) return true
  const startMs = parseIsoMs(startsAt)
  if (startMs == null) return true
  return nowMs >= startMs
}

/**
 * GEN1 (airdrop) holders keep their free-claim right for a fixed 7-day window from when the
 * AIRDROP phase opened, independent of `active_phase`. This mirrors the on-chain `gen1` candy
 * guard group (start + 7 days), so Gen1 holders can still self-mint concurrently after the launch
 * has advanced to PRESALE / WHITELIST / PUBLIC. Off-chain airdrop backstop covers anyone who
 * still hasn't claimed when this window closes.
 */
export const GEN1_AIRDROP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function isGen1AirdropWindowOpen(
  launch: Pick<OwlCenterLaunchPublic, 'launch_deadline_at' | 'phase_schedule'>,
  nowMs: number = Date.now()
): boolean {
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
