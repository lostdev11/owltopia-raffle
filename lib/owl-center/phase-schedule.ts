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

export type PublicSimpleMintWindowLaunch = Pick<
  OwlCenterLaunchPublic,
  | 'launch_deadline_at'
  | 'phase_schedule'
  | 'creator_wl_enabled'
  | 'creator_presale_enabled'
  | 'wl_supply'
  | 'presale_supply'
>

/**
 * True when the launch has presale/WL configured ahead of PUBLIC.
 * public_simple collections still mint only in PUBLIC — those earlier phases must finish
 * (or PUBLIC must have its own start) before the mint button opens.
 */
export function launchHasQueuedMintPhases(launch: PublicSimpleMintWindowLaunch): boolean {
  return (
    Boolean(launch.creator_wl_enabled) ||
    (launch.wl_supply ?? 0) > 0 ||
    Boolean(launch.creator_presale_enabled) ||
    (launch.presale_supply ?? 0) > 0
  )
}

function laterIso(a: string, b: string): string {
  const aMs = parseIsoMs(a)
  const bMs = parseIsoMs(b)
  if (aMs == null) return b
  if (bMs == null) return a
  return aMs >= bMs ? a : b
}

/**
 * When PUBLIC mint is allowed for a public_simple launch.
 * - Explicit PUBLIC start, floored by mint-opens (kickoff) when both exist
 * - Single-phase with only kickoff → that timestamp
 * - Presale/WL configured and PUBLIC has no start → null (not scheduled; must not open)
 */
export function getPublicSimpleMintOpensAt(launch: PublicSimpleMintWindowLaunch): string | null {
  const publicStart = launch.phase_schedule?.PUBLIC ?? null
  const kickoff = launch.launch_deadline_at ?? null
  if (publicStart && kickoff) return laterIso(publicStart, kickoff)
  if (publicStart) return publicStart
  if (launchHasQueuedMintPhases(launch)) return null
  return kickoff
}

export function isPublicSimpleMintOpen(
  launch: PublicSimpleMintWindowLaunch,
  nowMs: number = Date.now()
): boolean {
  const opensAt = getPublicSimpleMintOpensAt(launch)
  if (!opensAt) return !launchHasQueuedMintPhases(launch)
  const startMs = parseIsoMs(opensAt)
  if (startMs == null) return !launchHasQueuedMintPhases(launch)
  return nowMs >= startMs
}

export type PublicSimpleMintClosedInfo = {
  reason: string
  opensAt: string | null
}

/** Copy for the mint console when PUBLIC is not live yet. */
export function publicSimpleMintClosedInfo(
  launch: PublicSimpleMintWindowLaunch,
  nowMs: number = Date.now()
): PublicSimpleMintClosedInfo | null {
  if (isPublicSimpleMintOpen(launch, nowMs)) return null

  const opensAt = getPublicSimpleMintOpensAt(launch)
  if (opensAt) {
    const publicStart = launch.phase_schedule?.PUBLIC
    const kickoff = launch.launch_deadline_at
    const opensMs = parseIsoMs(opensAt)
    const label =
      publicStart && parseIsoMs(publicStart) === opensMs
        ? 'Public mint'
        : kickoff && parseIsoMs(kickoff) === opensMs
          ? 'Mint'
          : 'Public mint'
    return { reason: `${label} opens ${formatMintDate(opensAt)}`, opensAt }
  }

  const wlStart = launch.phase_schedule?.WHITELIST ?? null
  if (wlStart) {
    const wlMs = parseIsoMs(wlStart)
    if (wlMs != null && nowMs < wlMs) {
      return { reason: `Whitelist opens ${formatMintDate(wlStart)}`, opensAt: wlStart }
    }
  }
  const presaleStart = launch.phase_schedule?.PRESALE ?? null
  if (presaleStart) {
    const presaleMs = parseIsoMs(presaleStart)
    if (presaleMs != null && nowMs < presaleMs) {
      return { reason: `Presale opens ${formatMintDate(presaleStart)}`, opensAt: presaleStart }
    }
  }
  return { reason: 'Public mint is not scheduled yet — set a public start date', opensAt: null }
}

/**
 * On-chain Candy Guard startDate. Far-future when earlier phases exist but PUBLIC has no start,
 * so the CM cannot be minted against until the creator actually schedules public.
 */
export const PUBLIC_SIMPLE_UNSCHEDULED_START_ISO = '2099-01-01T00:00:00.000Z'

export function resolvePublicSimpleGuardStartDateIso(launch: PublicSimpleMintWindowLaunch): string | null {
  const opensAt = getPublicSimpleMintOpensAt(launch)
  if (opensAt) return opensAt
  if (launchHasQueuedMintPhases(launch)) return PUBLIC_SIMPLE_UNSCHEDULED_START_ISO
  return null
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

const DATETIME_LOCAL_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/

function parseAbsoluteIso(trimmed: string): string | null {
  const candidates = [trimmed]
  // `...+00` (no minutes) is invalid in some engines; `...+00:00` is not.
  if (/[+-]\d{2}$/.test(trimmed)) candidates.push(`${trimmed}:00`)
  for (const s of candidates) {
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return null
}

/**
 * Convert `<input type="datetime-local">` value to ISO (local → UTC).
 * Also passes through already-absolute timestamps (Z / offset) so a browser
 * payload is not re-interpreted as local on the UTC server.
 *
 * `new Date("YYYY-MM-DDTHH:mm")` is Invalid Date in Safari (seconds required),
 * which used to drop mint dates on save. Parse local components explicitly.
 */
export function datetimeLocalToIso(local: string): string | null {
  const trimmed = local.trim()
  if (!trimmed) return null

  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}(?::?\d{2})?$/.test(trimmed)) {
    return parseAbsoluteIso(trimmed)
  }

  const m = trimmed.match(DATETIME_LOCAL_RE)
  if (m) {
    const ms = Number((m[7] ?? '0').padEnd(3, '0').slice(0, 3))
    const d = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] ?? 0),
      ms
    )
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }

  return parseAbsoluteIso(trimmed)
}

/** Format ISO for datetime-local input in local timezone. */
export function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
