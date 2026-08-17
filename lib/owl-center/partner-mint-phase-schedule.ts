/**
 * Buyer-facing partner mint phase schedule (allowlist + public).
 * Powers LMNFT-style phase rows: name, price, per-wallet, start/end.
 */

import { launchHasPresaleProgram } from '@/lib/owl-center/launch-presale'
import {
  getActivePartnerAllowlistPhase,
  resolvePartnerAllowlistPhases,
  type PartnerAllowlistPhase,
} from '@/lib/owl-center/partner-allowlist-phases'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : null
}

export type PartnerMintPhaseScheduleRow = {
  key: string
  label: string
  kind: 'presale' | 'allowlist' | 'public'
  supply: number
  /** USDC notional; null = TBA; 0 = free. */
  price_usdc: number | null
  starts_at: string | null
  /** Next phase start or Public start ends this window. */
  ends_at: string | null
  wallet_mint_limit: number | null
  status: 'upcoming' | 'live' | 'ended'
  is_active: boolean
}

export type PartnerMintPricePick = {
  price_usdc: number | null
  /** true when quoting an open allowlist phase (not public). */
  from_allowlist: boolean
  allowlist_key: string | null
  allowlist_label: string | null
}

type ScheduleLaunch = Pick<
  OwlCenterLaunchPublic,
  | 'partner_allowlist_phases'
  | 'creator_wl_enabled'
  | 'wl_supply'
  | 'wl_price_usdc'
  | 'phase_schedule'
  | 'launch_deadline_at'
  | 'is_paused'
  | 'public_supply'
  | 'public_price_usdc'
  | 'wallet_mint_limit'
  | 'presale_supply'
  | 'creator_presale_enabled'
  | 'active_phase'
>

/** Unit USDC price for the live mint window (allowlist phase or public). */
export function resolvePartnerMintUnitPrice(
  launch: ScheduleLaunch,
  nowMs: number = Date.now()
): PartnerMintPricePick {
  const active = getActivePartnerAllowlistPhase(launch, nowMs)
  if (active) {
    return {
      price_usdc: active.price_usdc ?? launch.wl_price_usdc ?? launch.public_price_usdc,
      from_allowlist: true,
      allowlist_key: active.key,
      allowlist_label: active.label,
    }
  }
  return {
    price_usdc: launch.public_price_usdc,
    from_allowlist: false,
    allowlist_key: null,
    allowlist_label: null,
  }
}

function rowStatus(
  startsAt: string | null,
  endsAt: string | null,
  nowMs: number,
  forceEnded: boolean
): 'upcoming' | 'live' | 'ended' {
  if (forceEnded) return 'ended'
  const startMs = parseIsoMs(startsAt)
  const endMs = parseIsoMs(endsAt)
  if (endMs != null && nowMs >= endMs) return 'ended'
  if (startMs != null && nowMs < startMs) return 'upcoming'
  if (startMs == null && endMs == null) return 'upcoming'
  if (startMs != null && nowMs >= startMs && (endMs == null || nowMs < endMs)) return 'live'
  if (startMs == null && endMs != null && nowMs < endMs) return 'live'
  return 'upcoming'
}

/**
 * Ordered schedule rows for partner mint UI / hub cards.
 * Allowlist windows end when the next phase (or Public) starts.
 */
export function buildPartnerMintPhaseSchedule(
  launch: ScheduleLaunch,
  nowMs: number = Date.now()
): PartnerMintPhaseScheduleRow[] {
  const rows: PartnerMintPhaseScheduleRow[] = []
  const terminal =
    launch.active_phase === 'SOLD_OUT' || launch.active_phase === 'TRADING_ACTIVE'

  if (launchHasPresaleProgram(launch) && launch.presale_supply > 0) {
    const starts_at = launch.phase_schedule?.PRESALE ?? null
    const ends_at =
      partnerAllowlistEarliestOrPublic(launch) ?? launch.phase_schedule?.PUBLIC ?? null
    const status = rowStatus(starts_at, ends_at, nowMs, terminal)
    rows.push({
      key: 'presale',
      label: 'Presale',
      kind: 'presale',
      supply: launch.presale_supply,
      price_usdc: 0,
      starts_at,
      ends_at,
      wallet_mint_limit: null,
      status,
      is_active: status === 'live' && !terminal,
    })
  }

  const allowlists = resolvePartnerAllowlistPhases(launch)
  const publicStarts = launch.phase_schedule?.PUBLIC ?? null
  const activeAllowlist = getActivePartnerAllowlistPhase(launch, nowMs)

  for (let i = 0; i < allowlists.length; i++) {
    const phase = allowlists[i]!
    const next = allowlists[i + 1]
    const ends_at = next?.starts_at ?? publicStarts
    const status = rowStatus(phase.starts_at, ends_at, nowMs, terminal)
    const is_active = !terminal && activeAllowlist?.key === phase.key
    rows.push({
      key: phase.key,
      label: phase.label,
      kind: 'allowlist',
      supply: phase.supply,
      price_usdc: phase.price_usdc,
      starts_at: phase.starts_at,
      ends_at,
      wallet_mint_limit: launch.wallet_mint_limit > 0 ? launch.wallet_mint_limit : null,
      status: is_active ? 'live' : status,
      is_active,
    })
  }

  if (launch.public_supply > 0 || allowlists.length > 0) {
    const publicStartMs = parseIsoMs(publicStarts)
    let status: 'upcoming' | 'live' | 'ended' = 'upcoming'
    if (terminal) {
      status = launch.active_phase === 'TRADING_ACTIVE' ? 'ended' : 'ended'
    } else if (publicStartMs != null && nowMs >= publicStartMs) {
      status = 'live'
    } else if (publicStartMs == null && !activeAllowlist && launch.active_phase === 'PUBLIC') {
      status = 'live'
    } else if (publicStartMs != null && nowMs < publicStartMs) {
      status = 'upcoming'
    }

    rows.push({
      key: 'public',
      label: 'Public',
      kind: 'public',
      supply: Math.max(0, launch.public_supply),
      price_usdc: launch.public_price_usdc,
      starts_at: publicStarts,
      ends_at: null,
      wallet_mint_limit: launch.wallet_mint_limit > 0 ? launch.wallet_mint_limit : null,
      status,
      is_active: status === 'live' && !terminal && !activeAllowlist,
    })
  }

  return rows
}

function partnerAllowlistEarliestOrPublic(launch: ScheduleLaunch): string | null {
  const phases = resolvePartnerAllowlistPhases(launch)
  for (const p of phases) {
    if (p.starts_at) return p.starts_at
  }
  return launch.phase_schedule?.PUBLIC ?? null
}

/** Format USDC notional for schedule rows (Free / TBA / $N USDC). */
export function formatPartnerPhasePriceUsdc(price_usdc: number | null): string {
  if (price_usdc == null) return 'TBA'
  if (price_usdc <= 0) return 'Free'
  return `$${price_usdc} USDC`
}

export function partnerScheduleHasPhases(launch: ScheduleLaunch): boolean {
  return buildPartnerMintPhaseSchedule(launch).length > 0
}

/** Exported for tests — window end for an allowlist phase index. */
export function partnerAllowlistPhaseEndsAt(
  phases: PartnerAllowlistPhase[],
  index: number,
  publicStartsAt: string | null
): string | null {
  const next = phases[index + 1]
  return next?.starts_at ?? publicStartsAt
}
