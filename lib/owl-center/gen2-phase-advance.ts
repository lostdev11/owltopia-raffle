import { getOwlCenterLaunchBySlugAdmin, updateOwlCenterLaunchAdmin } from '@/lib/db/owl-center-launch'
import { isOwlCenterMintOperational } from '@/lib/owl-center/mint-policy'
import { getPhaseStartsAt, OWL_CENTER_MINTABLE_PHASES } from '@/lib/owl-center/phase-schedule'
import { sumOwlCenterPhaseMinted } from '@/lib/owl-center/presale-mint-pool'
import type { OwlCenterLaunchPublic, OwlCenterPhase, OwlCenterStatus } from '@/lib/owl-center/types'
import { isDevnetMintEnabled } from '@/lib/solana/network'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

const GEN2_SLUG = 'gen2'

const TERMINAL_PHASES: ReadonlySet<OwlCenterPhase> = new Set(['SOLD_OUT', 'TRADING_ACTIVE'])

/**
 * Sequential mint phases that auto-advance. A phase flips to the next when it is "done"
 * (its supply pool sells out OR its open window elapses) AND the next phase's scheduled
 * open floor has been reached. PUBLIC is last — it does not auto-advance here; the mint
 * RPC flips to SOLD_OUT when TOTAL supply is exhausted.
 *
 * Launch design (fixed clock + airdrop backstop). Times are offsets from the launch base
 * (`launch_deadline_at` = 16:00 UTC on the 26th):
 * - 16:00–16:25 AIRDROP (Gen1, free)        — 25-min self-mint window or sellout
 * - 16:25–16:50 PRESALE (free, prepaid)      — 25-min self-mint window or sellout
 * - 16:50–17:00 PRESALE_OVERAGE (free, +13)  — 10-min self-mint window or sellout
 * - 17:00–(+48h) WHITELIST ($30)             — opens at +1h floor, 48-hour window or sellout
 * - after WL    PUBLIC ($40)                  — opens once WL is done, absorbs leftover WL supply
 * The early windows cascade so WHITELIST opens ~17:00 and runs 48h; PUBLIC opens when WL sells
 * out or its 48h window elapses, and its pool absorbs whatever WL left unminted (see
 * {@link gen2PublicPoolCap}). Sellout advances earlier, but the WHITELIST/PUBLIC open floors hold
 * those phases to their wall-clock minimums. Anyone eligible for Gen1/Presale who does not
 * self-mint in their window is handled off-chain by the team's airdrop backstop (mint + send
 * within 7 days).
 */
export const GEN2_SEQUENTIAL_PHASES: readonly OwlCenterPhase[] = [
  'AIRDROP',
  'PRESALE',
  'PRESALE_OVERAGE',
  'WHITELIST',
  'PUBLIC',
]

const MINUTE_MS = 60 * 1000
const ONE_HOUR_MS = 60 * MINUTE_MS

/** WHITELIST stays open for 48 hours (if it never sells out) before its leftover rolls into PUBLIC. */
const WHITELIST_WINDOW_MS = 48 * ONE_HOUR_MS

/**
 * @deprecated Per-phase windows are now defined by {@link gen2PhaseWindowMs}.
 * Kept as the WHITELIST window length for back-compat / dashboard hints.
 */
export const GEN2_PHASE_MAX_DURATION_MS = WHITELIST_WINDOW_MS

/**
 * How long a phase stays open if it never sells out (fixed clock). The early windows
 * (25 + 25 + 10 = 60 min) cascade so WHITELIST opens ~17:00; WHITELIST then runs 48h.
 * Sellout can advance earlier within the early block, but the WHITELIST/PUBLIC open floors
 * hold those phases to their wall-clock minimums. PUBLIC/terminal never window-advance here.
 */
export function gen2PhaseWindowMs(phase: OwlCenterPhase): number {
  switch (phase) {
    case 'AIRDROP':
      return 25 * MINUTE_MS
    case 'PRESALE':
      return 25 * MINUTE_MS
    case 'PRESALE_OVERAGE':
      return 10 * MINUTE_MS
    case 'WHITELIST':
      return WHITELIST_WINDOW_MS
    default:
      return Number.POSITIVE_INFINITY
  }
}

/**
 * Earliest a phase may open, as an offset from the launch base (`launch_deadline_at`,
 * i.e. 16:00 UTC). A phase will not be entered before this floor even if the prior phase
 * is already done. Null = no floor (open as soon as the prior phase finishes).
 */
export function gen2PhaseOpenFloorOffsetMs(phase: OwlCenterPhase): number | null {
  switch (phase) {
    case 'WHITELIST':
      return ONE_HOUR_MS // +1h → ~17:00 UTC
    case 'PUBLIC':
      return 2 * ONE_HOUR_MS // +2h → ~18:00 UTC
    default:
      return null
  }
}

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : null
}

function nextSequentialPhase(phase: OwlCenterPhase): OwlCenterPhase | null {
  const idx = GEN2_SEQUENTIAL_PHASES.indexOf(phase)
  if (idx < 0) return null
  return GEN2_SEQUENTIAL_PHASES[idx + 1] ?? null
}

/** Supply pool cap for a phase (the number that, once minted, counts as "sold out"). */
export function gen2PhasePoolCap(
  launch: Pick<
    OwlCenterLaunchPublic,
    'airdrop_supply' | 'presale_supply' | 'presale_overage_supply' | 'wl_supply' | 'public_supply'
  >,
  phase: OwlCenterPhase
): number {
  switch (phase) {
    case 'AIRDROP':
      return launch.airdrop_supply
    case 'PRESALE':
      return launch.presale_supply
    case 'PRESALE_OVERAGE':
      return launch.presale_overage_supply
    case 'WHITELIST':
      return launch.wl_supply
    case 'PUBLIC':
      return launch.public_supply
    default:
      return 0
  }
}

/** Sequential phases at/after which WHITELIST is considered closed (its leftover may roll into PUBLIC). */
const GEN2_WHITELIST_CLOSED_PHASES: ReadonlySet<OwlCenterPhase> = new Set([
  'PUBLIC',
  'SOLD_OUT',
  'TRADING_ACTIVE',
])

/**
 * True once the sequential timeline has moved past WHITELIST — i.e. WHITELIST has either sold out or
 * its 48h window elapsed and the launch advanced to PUBLIC (or a terminal phase). Until then, WL is
 * still its own phase and its unminted spots are NOT rolled into PUBLIC.
 */
export function isGen2WhitelistClosed(launch: Pick<OwlCenterLaunchPublic, 'active_phase'>): boolean {
  return GEN2_WHITELIST_CLOSED_PHASES.has(launch.active_phase)
}

/**
 * WL spots that went unminted (`wl_supply − wl_minted`). Per community feedback, WL rarely mints
 * 100%, so once WL closes (48h window or sellout) its leftover rolls into the PUBLIC pool (see
 * {@link gen2PublicPoolCap}) instead of being stranded. AIRDROP/PRESALE leftover is intentionally
 * NOT rolled in — it stays reserved for the team's 7-day airdrop backstop.
 */
export function gen2WlLeftoverForPublic(
  launch: Pick<OwlCenterLaunchPublic, 'wl_supply'>,
  wlMintedGlobal: number
): number {
  return Math.max(0, launch.wl_supply - Math.max(0, wlMintedGlobal))
}

/**
 * PUBLIC pool cap = its own `public_supply`, plus whatever WL left unminted ONCE WL has closed
 * ({@link isGen2WhitelistClosed}). While WHITELIST is still its own live phase the leftover is held
 * back so PUBLIC buyers cannot take spots out from under WL holders. Still globally bounded by total
 * supply (`total_supply − minted_count`), enforced by the callers and the confirm-mint RPC.
 */
export function gen2PublicPoolCap(
  launch: Pick<OwlCenterLaunchPublic, 'public_supply' | 'wl_supply' | 'active_phase'>,
  wlMintedGlobal: number
): number {
  const base = Math.max(0, launch.public_supply)
  if (!isGen2WhitelistClosed(launch)) return base
  return base + gen2WlLeftoverForPublic(launch, wlMintedGlobal)
}

/**
 * True when WHITELIST lingers only as a concurrent (carried) phase — the primary phase already moved
 * on (e.g. to PUBLIC) — and its 48h window has elapsed. The cron then drops it from `active_phases`
 * so WL is officially closed and only PUBLIC (plus any other still-open concurrent phase such as the
 * paid presale / Gen1 airdrop) remains mintable.
 */
export function isConcurrentWhitelistWindowElapsed(input: {
  activePhase: OwlCenterPhase
  activePhases: readonly OwlCenterPhase[]
  whitelistStartMs: number | null
  nowMs: number
}): boolean {
  if (input.activePhase === 'WHITELIST') return false
  if (!input.activePhases.includes('WHITELIST')) return false
  if (input.whitelistStartMs == null || !Number.isFinite(input.whitelistStartMs)) return false
  const windowMs = gen2PhaseWindowMs('WHITELIST')
  if (!Number.isFinite(windowMs)) return false
  return input.nowMs >= input.whitelistStartMs + windowMs
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

export type Gen2PhaseDecision =
  | { advance: false; reason: string }
  | { advance: true; to: OwlCenterPhase; trigger: 'sold_out' | 'window_elapsed' }

/**
 * Pure decision: should the current phase advance now?
 * - Not yet started (now < activation) → no.
 * - Current phase "done" = pool sold out (minted >= cap) OR open longer than its window.
 * - If done but the next phase has an open floor not yet reached → hold (awaiting floor).
 * - If done and floor reached (or none) → advance, carrying the trigger reason.
 * - Otherwise hold (window still open).
 */
export function decideGen2PhaseTransition(input: {
  currentPhase: OwlCenterPhase
  activationMs: number | null
  mintedInPhase: number
  poolCap: number
  nowMs: number
  /** Window length for the current phase; defaults to {@link gen2PhaseWindowMs}. */
  maxDurationMs?: number
  /** Absolute earliest the NEXT phase may open. Null/undefined = no floor. */
  nextFloorMs?: number | null
}): Gen2PhaseDecision {
  const maxDurationMs = input.maxDurationMs ?? gen2PhaseWindowMs(input.currentPhase)
  const next = nextSequentialPhase(input.currentPhase)
  if (!next) return { advance: false, reason: 'final_phase' }
  if (input.activationMs == null || !Number.isFinite(input.activationMs)) {
    return { advance: false, reason: 'no_activation_time' }
  }
  if (input.nowMs < input.activationMs) return { advance: false, reason: 'phase_not_started' }

  const soldOut = input.poolCap > 0 && input.mintedInPhase >= input.poolCap
  const windowElapsed = Number.isFinite(maxDurationMs) && input.nowMs >= input.activationMs + maxDurationMs
  if (!soldOut && !windowElapsed) return { advance: false, reason: 'window_open' }

  // Current phase is done, but the next phase has not reached its scheduled open time.
  if (input.nextFloorMs != null && input.nowMs < input.nextFloorMs) {
    return { advance: false, reason: 'awaiting_next_floor' }
  }
  return { advance: true, to: next, trigger: soldOut ? 'sold_out' : 'window_elapsed' }
}

export type Gen2PhaseAdvanceResult =
  | { ok: true; advanced: false; reason: string; active_phase: OwlCenterPhase }
  | {
      ok: true
      advanced: true
      from_phase: OwlCenterPhase
      to_phase: OwlCenterPhase
      trigger: 'sold_out' | 'window_elapsed'
      activated_at: string
    }
  | { ok: false; error: string }

export function isGen2AutoPhaseAdvanceEligible(
  launch: Pick<OwlCenterLaunchPublic, 'slug' | 'mint_mode' | 'active_phase'>
): boolean {
  return launch.slug === GEN2_SLUG && launch.mint_mode === 'gen2_full' && !TERMINAL_PHASES.has(launch.active_phase)
}

/**
 * Advance Gen2 `active_phase` forward when the current phase has sold out or its open
 * window has elapsed. Records each phase's activation timestamp in `phase_schedule`
 * so the per-phase window is measured from when the phase actually opened.
 *
 * Only runs while the mint is live (not paused, not kill-switched, Candy Machine configured),
 * so the per-phase timer does not burn windows before launch.
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

  // Only progress the timeline while the mint is actually live.
  if (launch.is_paused || !isOwlCenterMintOperational(launch)) {
    return { ok: true, advanced: false, reason: 'mint_not_operational', active_phase: launch.active_phase }
  }

  // Officially close WHITELIST once its 48h window elapses, even when it only lingers as a concurrent
  // (carried) phase after the primary advanced to PUBLIC. After this, WL holders can no longer mint
  // their allocations — only PUBLIC (and any other still-open concurrent phase) remains. PUBLIC's pool
  // already absorbed the WL leftover, so the supply stays mintable; it just routes through PUBLIC.
  if (
    isConcurrentWhitelistWindowElapsed({
      activePhase: launch.active_phase,
      activePhases: launch.active_phases ?? [],
      whitelistStartMs: parseIsoMs(getPhaseStartsAt(launch, 'WHITELIST')),
      nowMs,
    })
  ) {
    const nextActivePhases = (launch.active_phases ?? []).filter((p) => p !== 'WHITELIST')
    const updated = await updateOwlCenterLaunchAdmin(GEN2_SLUG, { active_phases: nextActivePhases })
    if (!updated) return { ok: false, error: 'update_failed' }
    await getSupabaseAdmin()
      .from('owl_center_activity_logs')
      .insert({
        launch_id: launch.id,
        message: 'WHITELIST 48h window elapsed — WL officially closed; only PUBLIC remains mintable',
        event_type: 'system',
      })
    return { ok: true, advanced: false, reason: 'whitelist_window_closed', active_phase: launch.active_phase }
  }

  const current = launch.active_phase
  const activationMs = parseIsoMs(getPhaseStartsAt(launch, current))

  // Unknown activation (e.g. manual phase override with no schedule entry): stamp now so
  // its window starts from this moment, then hold for this cycle.
  if (activationMs == null) {
    await updateOwlCenterLaunchAdmin(GEN2_SLUG, {
      phase_schedule: { ...launch.phase_schedule, [current]: new Date(nowMs).toISOString() } as Record<string, string>,
    })
    return { ok: true, advanced: false, reason: 'stamped_activation', active_phase: current }
  }

  const network = isDevnetMintEnabled() ? 'devnet' : 'mainnet'
  const mintedInPhase = await sumOwlCenterPhaseMinted(launch.id, current, network)
  const poolCap = gen2PhasePoolCap(launch, current)

  // Next phase's open floor is measured from the launch base (launch_deadline_at = 16:00 UTC),
  // so WHITELIST/PUBLIC honor their wall-clock target even if early phases sell out faster.
  const baseMs = parseIsoMs(launch.launch_deadline_at)
  const next = nextSequentialPhase(current)
  const nextFloorOffset = next ? gen2PhaseOpenFloorOffsetMs(next) : null
  const nextFloorMs = baseMs != null && nextFloorOffset != null ? baseMs + nextFloorOffset : null

  const decision = decideGen2PhaseTransition({
    currentPhase: current,
    activationMs,
    mintedInPhase,
    poolCap,
    nowMs,
    maxDurationMs: gen2PhaseWindowMs(current),
    nextFloorMs,
  })
  if (!decision.advance) {
    return { ok: true, advanced: false, reason: decision.reason, active_phase: current }
  }

  const nextStatus = statusForAutoAdvancedPhase(decision.to)
  if (!nextStatus) {
    return { ok: true, advanced: false, reason: 'no_status_mapping', active_phase: current }
  }

  const activatedAt = new Date(nowMs).toISOString()
  // Additive rollout: keep the outgoing phase open concurrently with the new primary so earlier
  // phases stay live (admins can still close them manually via the live-phase toggles). The new
  // primary phase is always live, so it is excluded from the concurrent set to avoid duplication.
  const carriedPhases = Array.from(new Set<OwlCenterPhase>([...(launch.active_phases ?? []), current])).filter(
    (p) => OWL_CENTER_MINTABLE_PHASES.includes(p) && p !== decision.to
  )
  const updated = await updateOwlCenterLaunchAdmin(GEN2_SLUG, {
    active_phase: decision.to,
    active_phases: carriedPhases,
    status: nextStatus,
    phase_schedule: { ...launch.phase_schedule, [decision.to]: activatedAt } as Record<string, string>,
  })
  if (!updated) return { ok: false, error: 'update_failed' }

  const db = getSupabaseAdmin()
  await db.from('owl_center_activity_logs').insert({
    launch_id: launch.id,
    message: `AUTO phase advance ${current} → ${decision.to} (${decision.trigger}; minted ${mintedInPhase}/${poolCap})`,
    event_type: 'system',
  })

  return {
    ok: true,
    advanced: true,
    from_phase: current,
    to_phase: decision.to,
    trigger: decision.trigger,
    activated_at: activatedAt,
  }
}

/** Dashboard hint (sync, timer-based only — sellout requires a DB read done in the cron). */
export function previewGen2PhaseAdvance(
  launch: OwlCenterLaunchPublic,
  nowMs: number = Date.now()
): { would_advance: boolean; from_phase: OwlCenterPhase; to_phase: OwlCenterPhase | null; reason: string } {
  if (!isGen2AutoPhaseAdvanceEligible(launch)) {
    return { would_advance: false, from_phase: launch.active_phase, to_phase: null, reason: 'not_eligible' }
  }
  const next = nextSequentialPhase(launch.active_phase)
  if (!next) {
    return { would_advance: false, from_phase: launch.active_phase, to_phase: null, reason: 'final_phase' }
  }
  if (launch.is_paused) {
    return { would_advance: false, from_phase: launch.active_phase, to_phase: next, reason: 'mint_paused' }
  }
  const activationMs = parseIsoMs(getPhaseStartsAt(launch, launch.active_phase))
  if (activationMs == null) {
    return { would_advance: false, from_phase: launch.active_phase, to_phase: next, reason: 'no_activation_time' }
  }
  if (nowMs < activationMs) {
    return { would_advance: false, from_phase: launch.active_phase, to_phase: next, reason: 'phase_not_started' }
  }
  const windowMs = gen2PhaseWindowMs(launch.active_phase)
  if (Number.isFinite(windowMs) && nowMs >= activationMs + windowMs) {
    const baseMs = parseIsoMs(launch.launch_deadline_at)
    const floorOffset = gen2PhaseOpenFloorOffsetMs(next)
    const nextFloorMs = baseMs != null && floorOffset != null ? baseMs + floorOffset : null
    if (nextFloorMs != null && nowMs < nextFloorMs) {
      return { would_advance: false, from_phase: launch.active_phase, to_phase: next, reason: 'awaiting_next_floor' }
    }
    return { would_advance: true, from_phase: launch.active_phase, to_phase: next, reason: 'window_elapsed' }
  }
  return { would_advance: false, from_phase: launch.active_phase, to_phase: next, reason: 'window_open_or_sellout' }
}
