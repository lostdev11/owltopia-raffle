/**
 * Buyer-facing partner mint phase schedule (allowlist + public).
 * Powers LMNFT-style phase rows: name, price, per-wallet, start/end.
 */

import { formatPhasePriceSolOrFree } from '@/lib/owl-center/format-phase-price-sol'
import { launchHasPresaleProgram } from '@/lib/owl-center/launch-presale'
import {
  getActivePartnerAllowlistPhase,
  resolveEffectivePartnerAllowlistPhases,
  resolvePartnerAllowlistPhases,
  type PartnerAllowlistPhase,
} from '@/lib/owl-center/partner-allowlist-phases'
import { formatCreatorMintPriceLabel } from '@/lib/owl-center/platform-mint-fee'
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
  /** USDC notional; null = TBA or SOL-priced public. */
  price_usdc: number | null
  /** SOL public price when `public_price_usdc` is unset. */
  price_sol: number | null
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
  /** SOL mint price when public is SOL-denominated (`public_price_usdc` unset). */
  price_sol: number | null
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
  | 'creator_mint_price'
  | 'creator_mint_currency'
>

/** SOL public price when the creator saved mint price as SOL (USDC field stays null). */
export function publicSimpleSolMintPrice(
  launch: Pick<OwlCenterLaunchPublic, 'public_price_usdc' | 'creator_mint_price' | 'creator_mint_currency'>
): number | null {
  const n = Number(launch.creator_mint_price)
  if (!Number.isFinite(n) || n <= 0) return null
  const cur = String(launch.creator_mint_currency ?? 'SOL').trim().toUpperCase()
  if (cur === 'USDC') return null
  if (launch.public_price_usdc != null && launch.public_price_usdc > 0) return null
  return n
}

export function publicSimpleSolMintLamports(
  launch: Pick<OwlCenterLaunchPublic, 'public_price_usdc' | 'creator_mint_price' | 'creator_mint_currency'>
): string | null {
  const solAmt = publicSimpleSolMintPrice(launch)
  if (solAmt == null) return null
  return String(Math.round(solAmt * 1_000_000_000))
}

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
      price_sol: null,
    }
  }
  const price_sol = publicSimpleSolMintPrice(launch)
  return {
    price_usdc: price_sol != null ? null : launch.public_price_usdc,
    from_allowlist: false,
    allowlist_key: null,
    allowlist_label: null,
    price_sol,
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
      price_sol: null,
      starts_at,
      ends_at,
      wallet_mint_limit: null,
      status,
      is_active: status === 'live' && !terminal,
    })
  }

  const allowlists = resolveEffectivePartnerAllowlistPhases(launch)
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
      price_sol: null,
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
      price_sol: publicSimpleSolMintPrice(launch),
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

/** Active phase, else the next upcoming window (so pre-mint UI does not fall through to Public/Free). */
export function resolvePartnerMintConsolePhase(
  launch: ScheduleLaunch,
  nowMs: number = Date.now(),
  activeAllowlistKey?: string | null
): PartnerMintPhaseScheduleRow | null {
  const rows = buildPartnerMintPhaseSchedule(launch, nowMs)
  if (activeAllowlistKey) {
    const hit = rows.find((r) => r.key === activeAllowlistKey)
    if (hit) return hit
  }
  return rows.find((r) => r.is_active) ?? rows.find((r) => r.status === 'upcoming') ?? rows.find((r) => r.kind === 'public') ?? rows[0] ?? null
}

export function publicSimpleSettlementLabel(
  launch: Pick<
    OwlCenterLaunchPublic,
    'public_price_usdc' | 'creator_mint_price' | 'creator_mint_currency' | 'wl_price_usdc' | 'creator_wl_enabled'
  > &
    Partial<Pick<OwlCenterLaunchPublic, 'partner_allowlist_phases' | 'wl_supply'>>
): string {
  const solPublic = publicSimpleSolMintPrice(launch)
  const hasWl =
    launch.wl_price_usdc != null ||
    Boolean(launch.creator_wl_enabled) ||
    (launch.wl_supply ?? 0) > 0 ||
    (launch.partner_allowlist_phases?.length ?? 0) > 0
  if (solPublic != null && hasWl) return 'WL in USDC · public in SOL'
  if (solPublic != null) return 'SOL mint price'
  return 'USDC price · pay in SOL'
}

export function formatPartnerMintConsolePriceBits(
  row: PartnerMintPhaseScheduleRow | null,
  opts?: { liveSolLamports?: string | null; quotingThisPhase?: boolean }
): string {
  if (!row) return 'TBA'
  if (row.price_sol != null && row.price_sol > 0) {
    return `${formatCreatorMintPriceLabel(row.price_sol, 'SOL')} · pay in SOL`
  }
  if (row.price_usdc != null && row.price_usdc > 0) {
    const usdc = `$${row.price_usdc} USDC`
    if (opts?.quotingThisPhase && opts.liveSolLamports) {
      return `${usdc} · ${formatPhasePriceSolOrFree(opts.liveSolLamports, { paid: true })} · pay in SOL`
    }
    return `${usdc} · pay in SOL`
  }
  if (row.price_usdc === 0) return 'Free'
  return 'TBA'
}
