import { getOwlCenterLaunchBySlugAdmin, updateOwlCenterLaunchAdmin } from '@/lib/db/owl-center-launch'
import { getPhaseStartsAt, OWL_CENTER_SCHEDULED_PHASES } from '@/lib/owl-center/phase-schedule'
import type { OwlCenterLaunchPublic, OwlCenterPhase, OwlCenterStatus } from '@/lib/owl-center/types'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

const GEN2_SLUG = 'gen2'

const TERMINAL_PHASES: ReadonlySet<OwlCenterPhase> = new Set(['SOLD_OUT', 'TRADING_ACTIVE'])

function phaseIndex(phase: OwlCenterPhase): number {
  const i = OWL_CENTER_SCHEDULED_PHASES.indexOf(phase)
  return i >= 0 ? i : -1
}

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Latest scheduled phase whose start time has passed (walks phase order).
 * Returns null when mint has not opened yet or no phase has a scheduled start.
 */
export function resolveScheduledActivePhase(
  launch: Pick<OwlCenterLaunchPublic, 'launch_deadline_at' | 'phase_schedule'>,
  nowMs: number = Date.now()
): OwlCenterPhase | null {
  let latest: OwlCenterPhase | null = null
  for (const phase of OWL_CENTER_SCHEDULED_PHASES) {
    const startMs = parseIsoMs(getPhaseStartsAt(launch, phase))
    if (startMs == null || nowMs < startMs) continue
    latest = phase
  }
  return latest
}

/** Maps auto-advanced mint phase → launch status column. */
export function statusForAutoAdvancedPhase(phase: OwlCenterPhase): OwlCenterStatus | null {
  switch (phase) {
    case 'AIRDROP':
    case 'PRESALE':
    case 'PRESALE_OVERAGE':
      return 'PRESALE'
    case 'WHITELIST':
      return 'WHITELIST'
    case 'PUBLIC':
      return 'PUBLIC'
    case 'TRADING_ACTIVE':
      return 'TRADING_ACTIVE'
    default:
      return null
  }
}

export type Gen2PhaseAdvanceResult =
  | { ok: true; advanced: false; reason: string; active_phase: OwlCenterPhase }
  | {
      ok: true
      advanced: true
      from_phase: OwlCenterPhase
      to_phase: OwlCenterPhase
      scheduled_at: string
    }
  | { ok: false; error: string }

export function isGen2AutoPhaseAdvanceEligible(
  launch: Pick<OwlCenterLaunchPublic, 'slug' | 'mint_mode' | 'active_phase'>
): boolean {
  return launch.slug === GEN2_SLUG && launch.mint_mode === 'gen2_full' && !TERMINAL_PHASES.has(launch.active_phase)
}

/**
 * If Gen2 schedule says a later phase is live, bump `active_phase` + `status` (never backward).
 */
export async function advanceGen2PhaseIfScheduled(nowMs: number = Date.now()): Promise<Gen2PhaseAdvanceResult> {
  const launch = await getOwlCenterLaunchBySlugAdmin(GEN2_SLUG)
  if (!launch) return { ok: false, error: 'gen2_launch_not_found' }

  if (!isGen2AutoPhaseAdvanceEligible(launch)) {
    return {
      ok: true,
      advanced: false,
      reason: TERMINAL_PHASES.has(launch.active_phase) ? 'terminal_phase' : 'not_gen2_full',
      active_phase: launch.active_phase,
    }
  }

  const scheduled = resolveScheduledActivePhase(launch, nowMs)
  if (!scheduled) {
    return {
      ok: true,
      advanced: false,
      reason: 'mint_not_open_or_no_schedule',
      active_phase: launch.active_phase,
    }
  }

  const currentIdx = phaseIndex(launch.active_phase)
  const targetIdx = phaseIndex(scheduled)
  if (targetIdx < 0) {
    return { ok: true, advanced: false, reason: 'invalid_target_phase', active_phase: launch.active_phase }
  }

  if (currentIdx >= 0 && targetIdx <= currentIdx) {
    return {
      ok: true,
      advanced: false,
      reason: 'already_at_or_past_scheduled_phase',
      active_phase: launch.active_phase,
    }
  }

  const nextStatus = statusForAutoAdvancedPhase(scheduled)
  if (!nextStatus) {
    return { ok: true, advanced: false, reason: 'no_status_mapping', active_phase: launch.active_phase }
  }

  const updated = await updateOwlCenterLaunchAdmin(GEN2_SLUG, {
    active_phase: scheduled,
    status: nextStatus,
  })
  if (!updated) return { ok: false, error: 'update_failed' }

  const scheduledAt = getPhaseStartsAt(launch, scheduled) ?? new Date(nowMs).toISOString()
  const db = getSupabaseAdmin()
  await db.from('owl_center_activity_logs').insert({
    launch_id: launch.id,
    message: `AUTO phase advance ${launch.active_phase} → ${scheduled} (schedule ${scheduledAt})`,
    event_type: 'system',
  })

  return {
    ok: true,
    advanced: true,
    from_phase: launch.active_phase,
    to_phase: scheduled,
    scheduled_at: scheduledAt,
  }
}

/** Test helper: evaluate without writing. */
export function previewGen2PhaseAdvance(
  launch: OwlCenterLaunchPublic,
  nowMs: number = Date.now()
): { would_advance: boolean; from_phase: OwlCenterPhase; to_phase: OwlCenterPhase | null; reason: string } {
  if (!isGen2AutoPhaseAdvanceEligible(launch)) {
    return {
      would_advance: false,
      from_phase: launch.active_phase,
      to_phase: null,
      reason: 'not_eligible',
    }
  }
  const scheduled = resolveScheduledActivePhase(launch, nowMs)
  if (!scheduled) {
    return {
      would_advance: false,
      from_phase: launch.active_phase,
      to_phase: null,
      reason: 'mint_not_open_or_no_schedule',
    }
  }
  const currentIdx = phaseIndex(launch.active_phase)
  const targetIdx = phaseIndex(scheduled)
  if (currentIdx >= 0 && targetIdx <= currentIdx) {
    return {
      would_advance: false,
      from_phase: launch.active_phase,
      to_phase: scheduled,
      reason: 'already_at_or_past',
    }
  }
  return {
    would_advance: true,
    from_phase: launch.active_phase,
    to_phase: scheduled,
    reason: 'schedule_due',
  }
}
