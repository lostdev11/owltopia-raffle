import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { DEFAULT_PRESALE_OVERAGE_SUPPLY } from '@/lib/owl-center/launch-presale'
import {
  formRowsFromPartnerAllowlistPhases,
  parsePartnerAllowlistPhases,
  partnerAllowlistEarliestStart,
  partnerAllowlistPhasesFromFormRows,
  partnerAllowlistPrimaryPriceUsdc,
  partnerAllowlistTotalSupply,
  partnerPhasePriceSol,
  resolveEffectiveAllowlistStartsAt,
  resolvePartnerAllowlistPhases,
  type PartnerAllowlistPhase,
  type PartnerAllowlistPhaseFormRow,
} from '@/lib/owl-center/partner-allowlist-phases'
import { datetimeLocalToIso, isoToDatetimeLocal } from '@/lib/owl-center/phase-schedule'
import {
  DEFAULT_SELLER_FEE_BASIS_POINTS,
  basisPointsToPercent,
  launchSellerFeeBasisPoints,
  percentToBasisPoints,
} from '@/lib/owl-center/royalty'
import {
  defaultWalletSplitFormRows,
  parseWalletSplitFormRows,
  parseWalletSplitsFromBody,
  primaryWalletFromSplits,
  walletSplitFormRowsFromLaunch,
  type WalletSplit,
  type WalletSplitFormRow,
} from '@/lib/owl-center/wallet-splits'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type MintDetailsFormValues = {
  total_supply: string
  public_price: string
  /** @deprecated prefer allowlist_phases[0].price — kept for back-compat payloads */
  wl_price: string
  currency: 'SOL' | 'USDC'
  wallet_mint_limit: string
  launch_date: string
  public_start: string
  presale_enabled: boolean
  presale_supply: string
  presale_overage_supply: string
  presale_start: string
  /** True when allowlist_phases.length > 0 (or legacy single WL). */
  wl_enabled: boolean
  wl_supply: string
  wl_start: string
  /** Team / OG / WL / WL2 … (max 5). Empty + wl_enabled uses legacy single WL fields. */
  allowlist_phases: PartnerAllowlistPhaseFormRow[]
  /** Secondary royalty percent (0–100) — locked after Candy Machine deploy. */
  royalty_percent: string
  royalty_splits: WalletSplitFormRow[]
  mint_fund_splits: WalletSplitFormRow[]
  /** Default Core for new partner launches; `token_metadata` is legacy escape hatch. */
  mint_standard: 'core' | 'token_metadata'
  freeze_enabled: boolean
  unfreeze_date: string
}

export type ParsedMintDetailsConfig = {
  total_supply: number
  public_price: number
  wl_price: number | null
  currency: 'SOL' | 'USDC'
  wallet_mint_limit: number
  launch_deadline_at: string | null
  phase_schedule: Record<string, string>
  creator_presale_enabled: boolean
  creator_wl_enabled: boolean
  presale_supply: number
  presale_overage_supply: number
  wl_supply: number
  public_supply: number
  airdrop_supply: number
  public_price_usdc: number | null
  wl_price_usdc: number | null
  creator_mint_price: number
  creator_mint_currency: 'SOL' | 'USDC'
  seller_fee_basis_points: number
  royalty_splits: WalletSplit[] | null
  mint_fund_splits: WalletSplit[] | null
  treasury_wallet: string | null
  partner_allowlist_phases: PartnerAllowlistPhase[]
}

function pickNum(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function pickInt(v: unknown, fallback: number, min = 0, max = 50_000): number {
  const n = Math.floor(pickNum(v, fallback))
  return Math.min(max, Math.max(min, n))
}

function parseScheduleEntry(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  return datetimeLocalToIso(v.trim())
}

/** Keep the raw datetime-local value when ISO conversion fails so the server can still parse it. */
function formDateToPayload(local: string): string | null {
  const trimmed = local.trim()
  if (!trimmed) return null
  return datetimeLocalToIso(trimmed) ?? trimmed
}

function scheduleMs(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null
  const iso = datetimeLocalToIso(raw.trim()) ?? raw.trim()
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/** True when two schedule strings are the same instant (ISO or datetime-local). */
export function scheduleInstantsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const am = scheduleMs(a)
  const bm = scheduleMs(b)
  if (am == null && bm == null) return !a?.trim() && !b?.trim()
  return am != null && am === bm
}

/**
 * Prefer the DB-stored ISO when the requested value is the same instant.
 * Stops datetime-local round-trips (minute precision / reformatting) from rewriting
 * schedule columns on limit-only mint-config saves.
 */
export function preferStoredScheduleIso(
  requested: string | null | undefined,
  stored: string | null | undefined
): string | null {
  const storedTrim = stored?.trim() || null
  const requestedTrim = requested?.trim() || null
  if (storedTrim && scheduleInstantsEqual(requestedTrim, storedTrim)) return storedTrim
  if (!requestedTrim) return null
  return datetimeLocalToIso(requestedTrim) ?? requestedTrim
}

/**
 * PUBLIC start to persist with a mint-details save.
 *
 * Straight public mint: Mint opens is the live date.
 * Allowlist/presale: Public start may intentionally follow Mint opens (WL window → public).
 * Only treat an unchanged Public start as "leftover" when it was still tied to the previous
 * Mint opens and Mint opens itself moved — otherwise keep the later public window across saves.
 */
export function resolvePublicStartForSave(opts: {
  kickoff: string | null
  requestedPublic: string | null
  previousPublic?: string | null
  previousKickoff?: string | null
  hasQueuedPhases: boolean
}): string | null {
  const { kickoff, requestedPublic, previousPublic, previousKickoff, hasQueuedPhases } = opts
  if (!hasQueuedPhases) return kickoff ?? requestedPublic
  if (!kickoff) return requestedPublic
  if (!requestedPublic || scheduleInstantsEqual(requestedPublic, kickoff)) return kickoff
  const kickoffMoved =
    previousKickoff != null && !scheduleInstantsEqual(kickoff, previousKickoff)
  const publicUnchanged =
    previousPublic !== undefined && scheduleInstantsEqual(requestedPublic, previousPublic)
  const previousPublicWasSyncedToKickoff =
    previousKickoff != null &&
    previousPublic != null &&
    scheduleInstantsEqual(previousPublic, previousKickoff)
  if (kickoffMoved && publicUnchanged && previousPublicWasSyncedToKickoff) return kickoff
  return requestedPublic
}

/** Sync leftover allowlist starts when mint kickoff moves; clamp below kickoff. */
export function resolveAllowlistPhasesForSave(opts: {
  phases: PartnerAllowlistPhase[]
  kickoff: string | null
  previousKickoff?: string | null
  previousPublic?: string | null
  /** Prior persisted phases — used to keep starts_at byte-stable when instants match. */
  previousPhases?: PartnerAllowlistPhase[] | null
}): PartnerAllowlistPhase[] {
  const { phases, kickoff, previousKickoff, previousPublic, previousPhases } = opts
  const kickoffMoved =
    Boolean(kickoff?.trim()) &&
    previousKickoff != null &&
    !scheduleInstantsEqual(kickoff, previousKickoff)
  const previousPublicWasSyncedToKickoff =
    previousKickoff != null &&
    previousPublic != null &&
    scheduleInstantsEqual(previousPublic, previousKickoff)

  return phases.map((phase, idx) => {
    let starts_at = phase.starts_at
    if (starts_at && kickoff) {
      // Only drag phase starts when Mint opens actually moved — never on limit-only saves.
      if (kickoffMoved) {
        if (previousKickoff && scheduleInstantsEqual(starts_at, previousKickoff)) {
          starts_at = kickoff
        } else if (
          previousPublicWasSyncedToKickoff &&
          previousPublic &&
          scheduleInstantsEqual(starts_at, previousPublic)
        ) {
          starts_at = kickoff
        }
      }
      const effective = resolveEffectiveAllowlistStartsAt(starts_at, {
        launch_deadline_at: kickoff,
        phase_schedule: {},
      })
      const prevStored =
        previousPhases?.find((p) => p.key === phase.key)?.starts_at ?? previousPhases?.[idx]?.starts_at ?? null
      starts_at = preferStoredScheduleIso(effective, prevStored) ?? effective
    }
    return starts_at === phase.starts_at ? phase : { ...phase, starts_at }
  })
}

/**
 * Changing Mint opens also moves Public start when they were still tied together.
 * With allowlist/presale, a later Public start is kept so WL → public windows survive edits.
 */
export function applyMintOpensDate(values: MintDetailsFormValues, launch_date: string): MintDetailsFormValues {
  const previousKickoff = values.launch_date
  const previousPublic = values.public_start
  const hasQueuedPhases =
    values.presale_enabled || values.wl_enabled || values.allowlist_phases.length > 0
  const publicWasDiverged =
    hasQueuedPhases &&
    Boolean(previousKickoff.trim()) &&
    Boolean(previousPublic.trim()) &&
    !scheduleInstantsEqual(previousPublic, previousKickoff)
  const allowlist_phases = values.allowlist_phases.map((phase) => {
    if (!phase.start.trim()) return phase
    if (previousKickoff && scheduleInstantsEqual(phase.start, previousKickoff)) {
      return { ...phase, start: launch_date }
    }
    // Do not drag allowlist starts that matched an intentional later Public start.
    if (
      !publicWasDiverged &&
      previousPublic &&
      scheduleInstantsEqual(phase.start, previousPublic)
    ) {
      return { ...phase, start: launch_date }
    }
    return phase
  })
  const wl_start =
    values.wl_start.trim() &&
    (scheduleInstantsEqual(values.wl_start, previousKickoff) ||
      (!publicWasDiverged && scheduleInstantsEqual(values.wl_start, previousPublic)))
      ? launch_date
      : values.wl_start
  return {
    ...values,
    launch_date,
    public_start: publicWasDiverged ? previousPublic : launch_date,
    allowlist_phases,
    wl_start,
  }
}

/**
 * Straight public mint: if the two date fields diverged, the user edited Public start.
 * Mint opens edits already copy into Public start, so equal fields mean Mint opens is the source.
 */
export function resolveSimpleMintDate(kickoff: string | null, publicStart: string | null): string | null {
  if (kickoff && publicStart && !scheduleInstantsEqual(kickoff, publicStart)) return publicStart
  return kickoff ?? publicStart
}

/**
 * Canonical Mint opens ISO to write on save.
 * Simple public: either date field can move the live kickoff.
 * Allowlist/presale: Mint opens is derived from the first phase start (not a separate field).
 */
export function resolveMintOpensIsoForPatch(opts: {
  kickoff: string | null
  requestedPublic: string | null
  previousKickoff?: string | null
  previousPublic?: string | null
  hasQueuedPhases: boolean
  /** Earliest presale / allowlist start — wins over a leftover manual Mint opens. */
  firstPhaseKickoff?: string | null
}): string | null {
  const {
    kickoff,
    requestedPublic,
    previousKickoff,
    previousPublic,
    hasQueuedPhases,
    firstPhaseKickoff,
  } = opts

  if (hasQueuedPhases) {
    // Auto Mint opens = first phase start. Blank until a phase start exists.
    if (firstPhaseKickoff) return firstPhaseKickoff
    return null
  }

  const kickoffChanged = Boolean(kickoff && !scheduleInstantsEqual(kickoff, previousKickoff))
  const publicChanged = Boolean(requestedPublic && !scheduleInstantsEqual(requestedPublic, previousPublic))

  if (kickoffChanged) return kickoff
  if (publicChanged) return requestedPublic
  return resolveSimpleMintDate(kickoff, requestedPublic)
}

/** Earliest non-empty schedule instant among candidates (ISO or datetime-local). */
export function earliestScheduleInstant(
  candidates: Array<string | null | undefined>
): string | null {
  let best: string | null = null
  let bestMs: number | null = null
  for (const raw of candidates) {
    const ms = scheduleMs(raw)
    if (ms == null || !raw?.trim()) continue
    const iso = datetimeLocalToIso(raw.trim()) ?? raw.trim()
    if (bestMs == null || ms < bestMs) {
      bestMs = ms
      best = iso
    }
  }
  return best
}

/**
 * Mint opens when the first queued phase starts (presale or earliest allowlist).
 * Used so partners do not maintain a separate Mint opens field (Genbeta / WL flows).
 */
export function resolveMintOpensFromFirstPhase(opts: {
  presaleEnabled: boolean
  presaleStart?: string | null
  allowlistPhases?: Array<{ starts_at?: string | null; start?: string | null }>
  legacyWlStart?: string | null
}): string | null {
  const candidates: Array<string | null | undefined> = []
  if (opts.presaleEnabled) candidates.push(opts.presaleStart)
  const phases = opts.allowlistPhases ?? []
  for (const phase of phases) {
    candidates.push(phase.starts_at ?? phase.start)
  }
  if (phases.length === 0) candidates.push(opts.legacyWlStart)
  return earliestScheduleInstant(candidates)
}

/** Form helper: earliest phase start as datetime-local (or empty). */
export function resolveFormMintOpensFromFirstPhase(values: MintDetailsFormValues): string {
  const iso = resolveMintOpensFromFirstPhase({
    presaleEnabled: values.presale_enabled,
    presaleStart: values.presale_start,
    allowlistPhases: values.allowlist_phases.map((p) => ({ start: p.start })),
    legacyWlStart: values.wl_start,
  })
  if (!iso) return ''
  return isoToDatetimeLocal(iso) || iso
}

function requireScheduleEntry(
  raw: unknown,
  label: string
): { ok: true; iso: string | null } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: true, iso: null }
  const iso = parseScheduleEntry(raw)
  if (!iso) return { ok: false, error: `Invalid ${label}` }
  return { ok: true, iso }
}

/** Build mint config from launch submission or admin PATCH body. */
export function parseMintDetailsConfig(body: Record<string, unknown>): ParsedMintDetailsConfig | { error: string } {
  const total_supply = pickInt(body.total_supply, 0, 1, 1_000_000)
  if (total_supply < 1) return { error: 'Invalid total supply' }

  const currency = body.currency === 'USDC' ? 'USDC' : 'SOL'
  const public_price = pickNum(body.mint_price ?? body.public_price ?? body.creator_mint_price, 0)
  if (public_price < 0) return { error: 'Invalid public mint price' }

  const wl_price_raw = body.wl_price ?? body.wl_price_usdc
  const wl_price =
    wl_price_raw != null && wl_price_raw !== '' && Number.isFinite(Number(wl_price_raw))
      ? Math.max(0, Number(wl_price_raw))
      : null

  const wallet_mint_limit = pickInt(body.wallet_mint_limit, 5, 1, 50)

  const presale_enabled = Boolean(body.presale_enabled ?? body.creator_presale_enabled)

  let partner_allowlist_phases: PartnerAllowlistPhase[] = []
  if (Array.isArray(body.allowlist_phases) || Array.isArray(body.partner_allowlist_phases)) {
    const rawRows = (body.allowlist_phases ?? body.partner_allowlist_phases) as unknown[]
    // Form rows use {start,price}; stored rows use {starts_at,price_usdc}
    const looksLikeForm =
      rawRows.length > 0 &&
      rawRows.some(
        (r) =>
          r &&
          typeof r === 'object' &&
          ('start' in (r as object) || 'price' in (r as object) || 'price_currency' in (r as object))
      )
    if (looksLikeForm) {
      const parsedPhases = partnerAllowlistPhasesFromFormRows(
        rawRows as PartnerAllowlistPhaseFormRow[],
        (local) => parseScheduleEntry(local)
      )
      if ('error' in parsedPhases) return parsedPhases
      partner_allowlist_phases = parsedPhases
    } else {
      partner_allowlist_phases = parsePartnerAllowlistPhases(rawRows)
    }
  }

  const wl_enabled =
    partner_allowlist_phases.length > 0
      ? true
      : Boolean(body.wl_enabled ?? body.creator_wl_enabled)

  const presale_supply = presale_enabled
    ? pickInt(body.presale_supply, Math.min(total_supply, Math.max(1, Math.floor(total_supply * 0.9))), 0, total_supply)
    : 0

  const presale_overage_supply = presale_enabled
    ? pickInt(body.presale_overage_supply, DEFAULT_PRESALE_OVERAGE_SUPPLY, 0, 500)
    : 0

  let wl_supply = 0
  if (partner_allowlist_phases.length > 0) {
    wl_supply = Math.min(total_supply, partnerAllowlistTotalSupply(partner_allowlist_phases))
  } else if (wl_enabled) {
    wl_supply = pickInt(
      body.wl_supply,
      Math.min(total_supply - presale_supply, Math.max(0, Math.floor(total_supply * 0.1))),
      0,
      total_supply
    )
  }

  // GEN1 airdrop pool is not editable in the mint-details form, so preserve the
  // existing value (passed through from the launch row) instead of zeroing it.
  // Including it in the supply math keeps public from absorbing the airdrop pool.
  const airdrop_supply = pickInt(body.airdrop_supply, 0, 0, total_supply)

  const public_supply_explicit =
    body.public_supply != null && body.public_supply !== ''
      ? pickInt(body.public_supply, total_supply, 0, total_supply)
      : null

  let public_supply =
    public_supply_explicit ??
    (presale_enabled
      ? Math.max(0, total_supply - presale_supply - wl_supply - airdrop_supply)
      : Math.max(0, total_supply - wl_supply - airdrop_supply))

  if (presale_supply + wl_supply + public_supply + airdrop_supply > total_supply) {
    return { error: 'Phase supplies (airdrop + presale + WL + public) cannot exceed total supply' }
  }

  if (presale_supply + wl_supply + public_supply + airdrop_supply < total_supply) {
    public_supply += total_supply - (presale_supply + wl_supply + public_supply + airdrop_supply)
  }

  const launchDateParsed = requireScheduleEntry(body.launch_date ?? body.launch_deadline_at, 'mint open date')
  if (!launchDateParsed.ok) return launchDateParsed
  let launch_deadline_at = launchDateParsed.iso

  const phase_schedule: Record<string, string> = {}
  const rawSchedule = body.phase_schedule
  if (rawSchedule && typeof rawSchedule === 'object' && !Array.isArray(rawSchedule)) {
    for (const [k, v] of Object.entries(rawSchedule as Record<string, unknown>)) {
      const iso = parseScheduleEntry(v)
      if (iso) phase_schedule[k] = iso
    }
  }

  const presaleStartParsed = requireScheduleEntry(body.presale_start, 'presale start date')
  if (!presaleStartParsed.ok) return presaleStartParsed
  const wlStartParsed = requireScheduleEntry(body.wl_start, 'whitelist start date')
  if (!wlStartParsed.ok) return wlStartParsed
  const publicStartParsed = requireScheduleEntry(
    body.public_start ?? body.public_phase_start,
    'public phase start date'
  )
  if (!publicStartParsed.ok) return publicStartParsed
  const presale_start = presaleStartParsed.iso
  const wl_start = wlStartParsed.iso
  const public_start = publicStartParsed.iso

  if (presale_enabled && presale_start) phase_schedule.PRESALE = presale_start

  const earliestAllowlist = partnerAllowlistEarliestStart(partner_allowlist_phases)
  if (partner_allowlist_phases.length > 0 && earliestAllowlist) {
    phase_schedule.WHITELIST = earliestAllowlist
  } else if (wl_enabled && wl_start) {
    phase_schedule.WHITELIST = wl_start
  }

  const hasQueuedPhases = presale_enabled || wl_enabled || partner_allowlist_phases.length > 0
  // With queued phases, Mint opens is the first phase start — not a separate manual field.
  if (hasQueuedPhases) {
    launch_deadline_at = resolveMintOpensFromFirstPhase({
      presaleEnabled: presale_enabled,
      presaleStart: presale_start,
      allowlistPhases: partner_allowlist_phases,
      legacyWlStart: wl_start,
    })
  }
  const requestedPublic = public_start ?? phase_schedule.PUBLIC ?? null
  if (hasQueuedPhases) {
    const publicIso = resolvePublicStartForSave({
      kickoff: launch_deadline_at,
      requestedPublic,
      hasQueuedPhases,
    })
    if (publicIso) phase_schedule.PUBLIC = publicIso
    else delete phase_schedule.PUBLIC
  } else if (
    requestedPublic &&
    launch_deadline_at &&
    !scheduleInstantsEqual(requestedPublic, launch_deadline_at)
  ) {
    // Keep the divergence so the patch can tell "user edited Public start" from leftover PUBLIC.
    phase_schedule.PUBLIC = requestedPublic
  } else if (launch_deadline_at) {
    phase_schedule.PUBLIC = launch_deadline_at
  } else if (requestedPublic) {
    phase_schedule.PUBLIC = requestedPublic
  } else {
    delete phase_schedule.PUBLIC
  }

  if (launch_deadline_at && !phase_schedule.AIRDROP) phase_schedule.AIRDROP = launch_deadline_at
  else if (!launch_deadline_at) delete phase_schedule.AIRDROP

  const public_price_usdc = currency === 'USDC' ? public_price : null
  const multiPrice = partnerAllowlistPrimaryPriceUsdc(partner_allowlist_phases)
  const wl_price_usdc =
    partner_allowlist_phases.length > 0
      ? multiPrice
      : wl_enabled && wl_price != null
        ? wl_price
        : null

  // If multi-phase had no USDC prices but legacy wl_price was sent, keep it on first
  // phase only when that phase is not SOL-priced.
  if (partner_allowlist_phases.length > 0 && multiPrice == null && wl_price != null) {
    partner_allowlist_phases = partner_allowlist_phases.map((p, i) =>
      i === 0 && partnerPhasePriceSol(p) == null ? { ...p, price_usdc: wl_price } : p
    )
  }

  // Legacy single WL checkbox → persist as one allowlist phase.
  if (partner_allowlist_phases.length === 0 && wl_enabled) {
    partner_allowlist_phases = [
      {
        key: 'wl',
        label: 'Whitelist',
        starts_at: phase_schedule.WHITELIST ?? null,
        supply: wl_supply,
        price_usdc: wl_price_usdc,
        price_sol: null,
        wallet_mint_limit: null,
      },
    ]
  }

  let seller_fee_basis_points = DEFAULT_SELLER_FEE_BASIS_POINTS
  if (body.seller_fee_basis_points != null && body.seller_fee_basis_points !== '') {
    seller_fee_basis_points = Math.min(
      10_000,
      Math.max(0, Math.floor(Number(body.seller_fee_basis_points)))
    )
    if (!Number.isFinite(seller_fee_basis_points)) {
      return { error: 'Invalid royalty basis points' }
    }
  } else if (body.royalty_percent != null && body.royalty_percent !== '') {
    const pct = Number(body.royalty_percent)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return { error: 'Royalty must be between 0% and 100%' }
    }
    seller_fee_basis_points = percentToBasisPoints(pct)
  }

  const royaltySplits = parseWalletSplitsFromBody(body, 'royalty_splits', 'Secondary royalty split')
  if (royaltySplits && 'error' in royaltySplits) return { error: royaltySplits.error }

  const mintFundSplits = parseWalletSplitsFromBody(body, 'mint_fund_splits', 'Mint funds split')
  if (mintFundSplits && 'error' in mintFundSplits) return { error: mintFundSplits.error }

  let treasury_wallet: string | null = null
  if (typeof body.treasury_wallet === 'string' && body.treasury_wallet.trim()) {
    treasury_wallet = normalizeSolanaWalletAddress(body.treasury_wallet.trim())
    if (!treasury_wallet) return { error: 'Invalid treasury wallet' }
  } else if (mintFundSplits?.length) {
    treasury_wallet = primaryWalletFromSplits(mintFundSplits)
  }

  return {
    total_supply,
    public_price,
    wl_price,
    currency,
    wallet_mint_limit,
    launch_deadline_at,
    phase_schedule,
    creator_presale_enabled: presale_enabled,
    creator_wl_enabled: wl_enabled,
    presale_supply,
    presale_overage_supply,
    wl_supply,
    public_supply,
    airdrop_supply,
    public_price_usdc,
    wl_price_usdc,
    creator_mint_price: public_price,
    creator_mint_currency: currency,
    seller_fee_basis_points,
    royalty_splits: royaltySplits,
    mint_fund_splits: mintFundSplits,
    treasury_wallet,
    partner_allowlist_phases,
  }
}

export function mintDetailsFormFromLaunch(launch: OwlCenterLaunchPublic): MintDetailsFormValues {
  const currency = launch.creator_mint_currency === 'USDC' ? 'USDC' : 'SOL'
  const publicPrice =
    currency === 'USDC'
      ? String(launch.public_price_usdc ?? launch.creator_mint_price ?? 0)
      : String(launch.creator_mint_price ?? 0)

  const splitForms = walletSplitFormRowsFromLaunch(launch)
  const phases = resolvePartnerAllowlistPhases(launch)
  const allowlist_phases = formRowsFromPartnerAllowlistPhases(phases, (iso) => isoToDatetimeLocal(iso))

  return {
    total_supply: String(launch.total_supply),
    public_price: publicPrice,
    wl_price: launch.wl_price_usdc != null ? String(launch.wl_price_usdc) : '',
    currency,
    wallet_mint_limit: String(launch.wallet_mint_limit),
    launch_date: isoToDatetimeLocal(launch.launch_deadline_at),
    public_start: isoToDatetimeLocal(launch.phase_schedule?.PUBLIC),
    presale_enabled: launch.creator_presale_enabled || launch.presale_supply > 0,
    presale_supply: String(launch.presale_supply || ''),
    presale_overage_supply: String(launch.presale_overage_supply || ''),
    presale_start: isoToDatetimeLocal(launch.phase_schedule?.PRESALE),
    wl_enabled: phases.length > 0 || launch.creator_wl_enabled || launch.wl_supply > 0,
    wl_supply: String(launch.wl_supply || ''),
    wl_start: isoToDatetimeLocal(launch.phase_schedule?.WHITELIST),
    allowlist_phases,
    royalty_percent: String(basisPointsToPercent(launchSellerFeeBasisPoints(launch))),
    royalty_splits: splitForms.royalty_splits,
    mint_fund_splits: splitForms.mint_fund_splits,
    mint_standard: launch.mint_standard === 'token_metadata' ? 'token_metadata' : 'core',
    freeze_enabled: Boolean(launch.freeze_enabled),
    unfreeze_date: isoToDatetimeLocal(launch.unfreeze_date),
  }
}

export function mintDetailsPayloadFromForm(values: MintDetailsFormValues): Record<string, unknown> {
  const royaltySplits = parseWalletSplitFormRows(values.royalty_splits, 'Secondary royalty split')
  const mintFundSplits = parseWalletSplitFormRows(values.mint_fund_splits, 'Mint funds split')

  // Convert datetime-local values to ISO here (in the browser) so the
  // local→UTC offset uses the admin's timezone, not the server's (UTC).
  // Fall back to the raw field if conversion fails so the date is not dropped.
  const presaleIso = formDateToPayload(values.presale_start)
  const publicIso = formDateToPayload(values.public_start)

  const allowlist_phases = values.allowlist_phases.map((row) => ({
    ...row,
    start: formDateToPayload(row.start) ?? '',
  }))
  const wlEnabled = allowlist_phases.length > 0 || values.wl_enabled
  const hasQueuedPhases = wlEnabled || values.presale_enabled
  const firstPhaseKickoff = resolveMintOpensFromFirstPhase({
    presaleEnabled: values.presale_enabled,
    presaleStart: presaleIso,
    allowlistPhases: allowlist_phases,
    legacyWlStart: formDateToPayload(values.wl_start),
  })
  // Queued phases: Mint opens = first phase start (blank until a phase start exists).
  // Simple public: keep the Mint opens field.
  const launchIso = hasQueuedPhases ? firstPhaseKickoff : formDateToPayload(values.launch_date)
  const resolvedPublicIso = resolvePublicStartForSave({
    kickoff: launchIso,
    requestedPublic: publicIso,
    hasQueuedPhases,
  })
  const first = allowlist_phases[0]
  const wlIso = first?.start.trim()
    ? formDateToPayload(first.start)
    : formDateToPayload(values.wl_start)

  // Leave price keys out when the field is blank so an empty input preserves
  // the existing price instead of silently overwriting it with 0.
  const priceFields = values.public_price.trim()
    ? { mint_price: Number(values.public_price), public_price: Number(values.public_price) }
    : {}

  const wlPrice =
    first?.price_currency === 'SOL'
      ? null
      : first?.price.trim()
        ? Number(first.price)
        : values.wl_price.trim()
          ? Number(values.wl_price)
          : null

  return {
    total_supply: Number(values.total_supply),
    ...priceFields,
    wl_price: wlPrice,
    currency: values.currency,
    wallet_mint_limit: Number(values.wallet_mint_limit),
    launch_date: launchIso,
    presale_enabled: values.presale_enabled,
    presale_supply: values.presale_supply.trim() ? Number(values.presale_supply) : undefined,
    presale_overage_supply: values.presale_overage_supply.trim() ? Number(values.presale_overage_supply) : undefined,
    wl_enabled: wlEnabled,
    wl_supply:
      allowlist_phases.length > 0
        ? allowlist_phases.reduce((s, p) => s + (Math.floor(Number(p.supply) || 0)), 0)
        : values.wl_supply.trim()
          ? Number(values.wl_supply)
          : undefined,
    allowlist_phases,
    partner_allowlist_phases: allowlist_phases,
    phase_schedule: {
      ...(launchIso ? { AIRDROP: launchIso } : {}),
      ...(values.presale_enabled && presaleIso ? { PRESALE: presaleIso } : {}),
      ...(wlEnabled && wlIso ? { WHITELIST: wlIso } : {}),
      ...(resolvedPublicIso ? { PUBLIC: resolvedPublicIso } : {}),
    },
    presale_start: presaleIso,
    wl_start: wlIso,
    public_start: resolvedPublicIso,
    royalty_percent: values.royalty_percent.trim() ? Number(values.royalty_percent) : undefined,
    royalty_splits: 'error' in royaltySplits ? values.royalty_splits : royaltySplits,
    mint_fund_splits: 'error' in mintFundSplits ? values.mint_fund_splits : mintFundSplits,
    treasury_wallet:
      'error' in mintFundSplits ? undefined : primaryWalletFromSplits(mintFundSplits),
    mint_standard: values.mint_standard,
    freeze_enabled: values.freeze_enabled,
    unfreeze_date: values.freeze_enabled ? formDateToPayload(values.unfreeze_date) ?? '' : '',
  }
}

export function defaultMintDetailsFormValues(partial?: Partial<MintDetailsFormValues>): MintDetailsFormValues {
  const creator = partial?.royalty_splits?.[0]?.address ?? ''
  const treasury = partial?.mint_fund_splits?.[0]?.address ?? creator

  return {
    total_supply: '1000',
    public_price: '1',
    wl_price: '',
    currency: 'SOL',
    wallet_mint_limit: '5',
    launch_date: '',
    public_start: '',
    presale_enabled: false,
    presale_supply: '',
    presale_overage_supply: '13',
    presale_start: '',
    wl_enabled: false,
    wl_supply: '',
    wl_start: '',
    allowlist_phases: [],
    royalty_percent: '5',
    royalty_splits: defaultWalletSplitFormRows(creator),
    mint_fund_splits: defaultWalletSplitFormRows(treasury),
    mint_standard: 'core',
    freeze_enabled: false,
    unfreeze_date: '',
    ...partial,
  }
}

/** Primary “mint opens” timestamp for cards — Mint opens field, else PUBLIC. */
export function resolveMintOpensAt(
  launch: Pick<OwlCenterLaunchPublic, 'launch_deadline_at' | 'phase_schedule'>
): string | null {
  return launch.launch_deadline_at ?? launch.phase_schedule?.PUBLIC ?? null
}
