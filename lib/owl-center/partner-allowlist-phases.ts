/**
 * Partner (public_simple) multi-allowlist phases: Team / OG / WL / WL2 / …
 * Soft-gated before PUBLIC; on-chain mint remains PUBLIC phase.
 */

export const PARTNER_ALLOWLIST_PRESETS = [
  { key: 'team', label: 'Team' },
  { key: 'og', label: 'OG' },
  { key: 'wl', label: 'Whitelist' },
  { key: 'wl2', label: 'WL 2' },
  { key: 'wl3', label: 'WL 3' },
] as const

export const PARTNER_ALLOWLIST_MAX_PHASES = 5

export type PartnerAllowlistPhase = {
  key: string
  label: string
  /** ISO start time; required for the phase to open. */
  starts_at: string | null
  supply: number
  price_usdc: number | null
  /**
   * Max mints per wallet during this allowlist phase.
   * Null / omit = inherit launch.wallet_mint_limit (public / legacy default).
   */
  wallet_mint_limit?: number | null
}

export type PartnerAllowlistPhaseFormRow = {
  key: string
  label: string
  start: string
  supply: string
  price: string
  /** Empty / omit = inherit public / launch wallet_mint_limit. */
  wallet_mint_limit?: string
}

/** Clamp partner per-wallet mint caps (matches launch.wallet_mint_limit bounds). */
export function clampPartnerWalletMintLimit(raw: number | null | undefined): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return 5
  return Math.min(50, Math.max(1, n))
}

/**
 * Resolve the effective per-wallet cap for an allowlist phase.
 * Phase override when set; otherwise launch-level (public) wallet_mint_limit.
 */
export function resolvePartnerPhaseWalletMintLimit(
  phase: Pick<PartnerAllowlistPhase, 'wallet_mint_limit'> | null | undefined,
  launchWalletMintLimit: number | null | undefined
): number {
  if (phase?.wallet_mint_limit != null && phase.wallet_mint_limit > 0) {
    return clampPartnerWalletMintLimit(phase.wallet_mint_limit)
  }
  return clampPartnerWalletMintLimit(launchWalletMintLimit)
}

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : null
}

export function normalizePhaseKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

export function parsePartnerAllowlistPhases(raw: unknown): PartnerAllowlistPhase[] {
  if (!Array.isArray(raw)) return []
  const out: PartnerAllowlistPhase[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const key = normalizePhaseKey(typeof row.key === 'string' ? row.key : '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    const label =
      typeof row.label === 'string' && row.label.trim()
        ? row.label.trim().slice(0, 40)
        : key.toUpperCase()
    const startsRaw = typeof row.starts_at === 'string' ? row.starts_at : null
    const startsMs = parseIsoMs(startsRaw)
    const supply = Math.max(0, Math.floor(Number(row.supply ?? 0) || 0))
    const priceRaw = row.price_usdc
    const price_usdc =
      priceRaw != null && priceRaw !== '' && Number.isFinite(Number(priceRaw))
        ? Math.max(0, Number(priceRaw))
        : null
    const limitRaw = row.wallet_mint_limit
    const wallet_mint_limit =
      limitRaw != null && limitRaw !== '' && Number.isFinite(Number(limitRaw))
        ? clampPartnerWalletMintLimit(Number(limitRaw))
        : null
    out.push({
      key,
      label,
      starts_at: startsMs != null ? new Date(startsMs).toISOString() : null,
      supply,
      price_usdc,
      wallet_mint_limit,
    })
    if (out.length >= PARTNER_ALLOWLIST_MAX_PHASES) break
  }
  return sortPartnerAllowlistPhases(out)
}

export function sortPartnerAllowlistPhases(phases: PartnerAllowlistPhase[]): PartnerAllowlistPhase[] {
  return [...phases].sort((a, b) => {
    const am = parseIsoMs(a.starts_at)
    const bm = parseIsoMs(b.starts_at)
    if (am == null && bm == null) return a.key.localeCompare(b.key)
    if (am == null) return 1
    if (bm == null) return -1
    if (am !== bm) return am - bm
    return a.key.localeCompare(b.key)
  })
}

/** Legacy single WHITELIST → one synthetic phase when jsonb is empty. */
export function resolvePartnerAllowlistPhases(launch: {
  partner_allowlist_phases?: PartnerAllowlistPhase[] | null
  creator_wl_enabled?: boolean
  wl_supply?: number
  wl_price_usdc?: number | null
  phase_schedule?: Partial<Record<string, string>>
}): PartnerAllowlistPhase[] {
  const stored = parsePartnerAllowlistPhases(launch.partner_allowlist_phases ?? [])
  if (stored.length > 0) return stored
  if (!launch.creator_wl_enabled && !(Number(launch.wl_supply ?? 0) > 0)) return []
  return [
    {
      key: 'wl',
      label: 'Whitelist',
      starts_at: launch.phase_schedule?.WHITELIST ?? null,
      supply: Number(launch.wl_supply ?? 0),
      price_usdc: launch.wl_price_usdc ?? null,
      wallet_mint_limit: null,
    },
  ]
}

export function partnerAllowlistEarliestStart(phases: PartnerAllowlistPhase[]): string | null {
  for (const p of sortPartnerAllowlistPhases(phases)) {
    if (p.starts_at) return p.starts_at
  }
  return null
}

type AllowlistKickoffLaunch = Pick<
  { launch_deadline_at?: string | null; phase_schedule?: Partial<Record<string, string>> },
  'launch_deadline_at' | 'phase_schedule'
>

/** Mint kickoff — allowlist phases cannot open before this instant. */
export function resolveAllowlistKickoffMs(launch: AllowlistKickoffLaunch): number | null {
  return parseIsoMs(launch.launch_deadline_at) ?? parseIsoMs(launch.phase_schedule?.PUBLIC)
}

/**
 * Clamp stale allowlist starts that predate mint kickoff on a different calendar day
 * (e.g. leftover WL after Mint opens moved from Aug 24 → Sep 5).
 */
export function resolveEffectiveAllowlistStartsAt(
  phaseStart: string | null | undefined,
  launch: AllowlistKickoffLaunch
): string | null {
  if (!phaseStart?.trim()) return null
  const phaseMs = parseIsoMs(phaseStart)
  if (phaseMs == null) return null
  const kickoffMs = resolveAllowlistKickoffMs(launch)
  if (kickoffMs != null && phaseMs < kickoffMs) {
    const phaseDay = new Date(phaseMs).toISOString().slice(0, 10)
    const kickoffDay = new Date(kickoffMs).toISOString().slice(0, 10)
    if (phaseDay !== kickoffDay) {
      return new Date(kickoffMs).toISOString()
    }
  }
  return new Date(phaseMs).toISOString()
}

export function resolveEffectivePartnerAllowlistPhases(launch: {
  partner_allowlist_phases?: PartnerAllowlistPhase[] | null
  creator_wl_enabled?: boolean
  wl_supply?: number
  wl_price_usdc?: number | null
  phase_schedule?: Partial<Record<string, string>>
  launch_deadline_at?: string | null
}): PartnerAllowlistPhase[] {
  return resolvePartnerAllowlistPhases(launch).map((phase) => ({
    ...phase,
    starts_at: resolveEffectiveAllowlistStartsAt(phase.starts_at, launch),
  }))
}

export function partnerAllowlistTotalSupply(phases: PartnerAllowlistPhase[]): number {
  return phases.reduce((s, p) => s + Math.max(0, p.supply), 0)
}

/** Price for the active allowlist phase (first non-null among sorted, or active). */
export function partnerAllowlistPrimaryPriceUsdc(phases: PartnerAllowlistPhase[]): number | null {
  for (const p of sortPartnerAllowlistPhases(phases)) {
    if (p.price_usdc != null) return p.price_usdc
  }
  return null
}

export function getActivePartnerAllowlistPhase(
  launch: {
    partner_allowlist_phases?: PartnerAllowlistPhase[] | null
    creator_wl_enabled?: boolean
    wl_supply?: number
    wl_price_usdc?: number | null
    phase_schedule?: Partial<Record<string, string>>
    launch_deadline_at?: string | null
    is_paused?: boolean
  },
  nowMs: number = Date.now()
): PartnerAllowlistPhase | null {
  if (launch.is_paused) return null
  const phases = resolveEffectivePartnerAllowlistPhases(launch).filter((p) => p.starts_at)
  if (phases.length < 1) return null

  const publicMs = parseIsoMs(launch.phase_schedule?.PUBLIC)
  if (publicMs != null && nowMs >= publicMs) return null

  let active: PartnerAllowlistPhase | null = null
  for (const p of phases) {
    const startMs = parseIsoMs(p.starts_at)
    if (startMs == null || nowMs < startMs) break
    active = p
  }
  return active
}

export function isPartnerAllowlistWaiting(
  launch: {
    partner_allowlist_phases?: PartnerAllowlistPhase[] | null
    creator_wl_enabled?: boolean
    wl_supply?: number
    wl_price_usdc?: number | null
    phase_schedule?: Partial<Record<string, string>>
    is_paused?: boolean
  },
  nowMs: number = Date.now()
): boolean {
  if (launch.is_paused) return false
  const phases = resolveEffectivePartnerAllowlistPhases(launch)
  const earliest = partnerAllowlistEarliestStart(phases)
  const earliestMs = parseIsoMs(earliest)
  if (earliestMs == null) return false
  return nowMs < earliestMs
}

export function isPartnerAllowlistWindowOpen(
  launch: {
    partner_allowlist_phases?: PartnerAllowlistPhase[] | null
    creator_wl_enabled?: boolean
    wl_supply?: number
    wl_price_usdc?: number | null
    phase_schedule?: Partial<Record<string, string>>
    is_paused?: boolean
  },
  nowMs: number = Date.now()
): boolean {
  return getActivePartnerAllowlistPhase(launch, nowMs) != null
}

export function formRowsFromPartnerAllowlistPhases(
  phases: PartnerAllowlistPhase[],
  isoToLocal: (iso: string) => string
): PartnerAllowlistPhaseFormRow[] {
  return phases.map((p) => ({
    key: p.key,
    label: p.label,
    start: p.starts_at ? isoToLocal(p.starts_at) : '',
    supply: p.supply > 0 ? String(p.supply) : '',
    price: p.price_usdc != null ? String(p.price_usdc) : '',
    wallet_mint_limit: p.wallet_mint_limit != null ? String(p.wallet_mint_limit) : '',
  }))
}

export function partnerAllowlistPhasesFromFormRows(
  rows: PartnerAllowlistPhaseFormRow[],
  datetimeLocalToIso: (local: string) => string | null
): PartnerAllowlistPhase[] | { error: string } {
  if (rows.length > PARTNER_ALLOWLIST_MAX_PHASES) {
    return { error: `Max ${PARTNER_ALLOWLIST_MAX_PHASES} allowlist phases` }
  }
  const built: PartnerAllowlistPhase[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const key = normalizePhaseKey(row.key || row.label)
    if (!key) return { error: 'Each allowlist phase needs a key/label' }
    if (seen.has(key)) return { error: `Duplicate allowlist phase key: ${key}` }
    seen.add(key)
    const label = (row.label.trim() || key).slice(0, 40)
    const startIso = row.start.trim() ? datetimeLocalToIso(row.start.trim()) : null
    if (row.start.trim() && !startIso) return { error: `Invalid start time for ${label}` }
    const supply = Math.max(0, Math.floor(Number(row.supply) || 0))
    const price =
      row.price.trim() && Number.isFinite(Number(row.price))
        ? Math.max(0, Number(row.price))
        : null
    const limitTrim = (row.wallet_mint_limit ?? '').trim()
    const wallet_mint_limit =
      limitTrim && Number.isFinite(Number(limitTrim))
        ? clampPartnerWalletMintLimit(Number(limitTrim))
        : null
    built.push({
      key,
      label,
      starts_at: startIso,
      supply,
      price_usdc: price,
      wallet_mint_limit,
    })
  }
  return sortPartnerAllowlistPhases(built)
}

export function nextPresetForPhases(existing: PartnerAllowlistPhaseFormRow[]): {
  key: string
  label: string
} {
  const used = new Set(existing.map((p) => normalizePhaseKey(p.key)))
  for (const preset of PARTNER_ALLOWLIST_PRESETS) {
    if (!used.has(preset.key)) return { ...preset }
  }
  let n = existing.length + 1
  while (used.has(`wl${n}`)) n++
  return { key: `wl${n}`, label: `WL ${n}` }
}
