/**
 * Public leaderboard: top 10 by raffles entered, tickets purchased, raffles created, raffles won, and tickets sold (by creators).
 * Supports all-time, UTC calendar month, and UTC calendar year scopes.
 *
 * **Rollup modes** (`LEADERBOARD_NEW_RULES_EFFECTIVE_MONTH`, UTC `YYYY-MM`):
 * - **All-time** and months/years **before** that month keep **legacy** rules (floor price + `failed_refund_available` only).
 * - From the effective month onward, **threshold** rules apply: draw threshold met, plus exclude `cancelled` / `draft`.
 * Entries ignore complimentary, refunded, and zero-amount rows. Caps / distinct buyers — lib/leaderboard/hardening.ts.
 * Raffles won counts every completed / successful_pending_claims draw (by winner_selected_at); it does not apply ticket floors or draw-threshold exclusion.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  entryQualifiesForPlayerLeaderboard,
  leaderboardMinTicketPriceSol,
  leaderboardPurchaseMaxTicketsPerWalletPerRaffle,
  leaderboardTicketsSoldMinDistinctNonCreatorBuyers,
  leaderboardWalletIsExcluded,
  raffleCountsTowardLeaderboard,
} from '@/lib/leaderboard/hardening'
import { getEffectiveDrawThresholdTickets } from '@/lib/raffles/nft-raffle-economics'
import type { Raffle } from '@/lib/types'

/** PostgREST page size; must paginate — a hard .limit() undercounts once row count exceeds the cap. */
const LEADERBOARD_PAGE_SIZE = 2500

/** Raffles likely did not exist before this year; clamps year picker / API. */
const LEADERBOARD_MIN_YEAR = 2024
const LEADERBOARD_MAX_YEAR = 2100

export type LeaderboardEntry = {
  rank: number
  wallet: string
  value: number
}

export type LeaderboardData = {
  rafflesEntered: LeaderboardEntry[]
  ticketsPurchased: LeaderboardEntry[]
  rafflesCreated: LeaderboardEntry[]
  ticketsSold: LeaderboardEntry[]
  rafflesWon: LeaderboardEntry[]
}

export type LeaderboardPeriod =
  | { kind: 'all' }
  | { kind: 'month'; year: number; month: number }
  | { kind: 'year'; year: number }

/** `legacy` = pre-cutover methodology; `threshold` = draw-threshold + stricter statuses (see module doc). */
export type LeaderboardRulesMode = 'legacy' | 'threshold'

export type LeaderboardPeriodMeta = {
  kind: 'all' | 'month' | 'year'
  year?: number
  month?: number
  /** Human-readable scope, e.g. "April 2026 (UTC)" */
  label: string
  /** Inclusive UTC range start (ISO), if scoped */
  rangeStart?: string
  /** Exclusive UTC range end (ISO), if scoped */
  rangeEndExclusive?: string
  leaderboardRules?: LeaderboardRulesMode
  /** Server floor for ticket_price (SOL); UI copy should match. */
  minTicketPriceSol?: number
}

type TimeWindow = { startIso: string; endIso: string }

type LeaderboardRaffleRow = {
  id: string
  created_by: string | null
  creator_wallet: string | null
  winner_wallet: string | null
  status: string | null
  created_at: string
  winner_selected_at: string | null
  ticket_price: number | string | null
  currency: string | null
  alternate_ticket_currency: string | null
  alternate_ticket_price: number | string | null
  prize_type: string | null
  min_tickets: number | string | null
  floor_price: string | null
}

type LeaderboardEntryRow = {
  id: string
  raffle_id: string
  wallet_address: string
  ticket_quantity: number
  verified_at: string | null
  created_at: string
  amount_paid: number | string | null
  refunded_at: string | null
  referral_complimentary: boolean | null
}

function normalizeWallet(v: string | null | undefined): string {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || ''
}

function clampYear(y: number): number {
  return Math.min(LEADERBOARD_MAX_YEAR, Math.max(LEADERBOARD_MIN_YEAR, y))
}

function utcMonthWindow(year: number, month1to12: number): TimeWindow {
  const y = clampYear(year)
  const m = month1to12
  const start = Date.UTC(y, m - 1, 1, 0, 0, 0, 0)
  const end = Date.UTC(y, m, 1, 0, 0, 0, 0)
  return { startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString() }
}

function utcYearWindow(year: number): TimeWindow {
  const y = clampYear(year)
  const start = Date.UTC(y, 0, 1, 0, 0, 0, 0)
  const end = Date.UTC(y + 1, 0, 1, 0, 0, 0, 0)
  return { startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString() }
}

function monthLabel(year: number, month1to12: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    Date.UTC(year, month1to12 - 1, 1)
  )
}

export function periodToWindow(period: LeaderboardPeriod): TimeWindow | null {
  if (period.kind === 'all') return null
  if (period.kind === 'month') return utcMonthWindow(period.year, period.month)
  return utcYearWindow(period.year)
}

export function buildLeaderboardPeriodMeta(period: LeaderboardPeriod): LeaderboardPeriodMeta {
  if (period.kind === 'all') {
    return { kind: 'all', label: 'All time' }
  }
  const w = periodToWindow(period)!
  if (period.kind === 'month') {
    return {
      kind: 'month',
      year: period.year,
      month: period.month,
      label: `${monthLabel(period.year, period.month)} (UTC)`,
      rangeStart: w.startIso,
      rangeEndExclusive: w.endIso,
    }
  }
  return {
    kind: 'year',
    year: period.year,
    label: `${period.year} (UTC)`,
    rangeStart: w.startIso,
    rangeEndExclusive: w.endIso,
  }
}

/**
 * Parse query params for GET /api/leaderboard.
 * Default: current UTC calendar month (monthly “season”).
 */
export function parseLeaderboardPeriodFromSearchParams(searchParams: URLSearchParams): LeaderboardPeriod {
  const period = (searchParams.get('period') || 'month').toLowerCase()
  if (period === 'all') return { kind: 'all' }
  if (period === 'year') {
    const y = parseInt(searchParams.get('year') || '', 10)
    const year = Number.isFinite(y) ? clampYear(y) : new Date().getUTCFullYear()
    return { kind: 'year', year }
  }
  const now = new Date()
  const y = parseInt(searchParams.get('year') || '', 10)
  const m = parseInt(searchParams.get('month') || '', 10)
  const year = Number.isFinite(y) ? clampYear(y) : now.getUTCFullYear()
  const month = Number.isFinite(m) && m >= 1 && m <= 12 ? m : now.getUTCMonth() + 1
  return { kind: 'month', year, month }
}

function takeTopTen(items: { wallet: string; value: number }[]): LeaderboardEntry[] {
  return items
    .sort((a, b) => b.value - a.value || a.wallet.localeCompare(b.wallet))
    .slice(0, 10)
    .map((item, i) => ({ rank: i + 1, wallet: item.wallet, value: item.value }))
}

function statusCountsAsRaffleWon(status: string | null): boolean {
  const s = (status || '').toLowerCase()
  return s === 'completed' || s === 'successful_pending_claims'
}

/** Legacy aggregates: same terminal exclusion as early leaderboard (min-threshold failure refunds only). */
function isFailedRefundOnlyLeaderboardExcluded(status: string | null): boolean {
  return (status || '').toLowerCase() === 'failed_refund_available'
}

/** Threshold aggregates: also drop cancelled / draft. */
function isLeaderboardExcludedByStatusThreshold(status: string | null): boolean {
  const s = (status || '').toLowerCase()
  return s === 'failed_refund_available' || s === 'cancelled' || s === 'draft'
}

/** Wins: terminal failures / non-draw statuses only — not ticket floors or draw-threshold rollups. */
function raffleStatusExcludedFromWinsLeaderboard(
  status: string | null,
  mode: LeaderboardRulesMode
): boolean {
  if (mode === 'legacy') return isFailedRefundOnlyLeaderboardExcluded(status)
  return isLeaderboardExcludedByStatusThreshold(status)
}

/**
 * Same rule as {@link canSelectWinner}: confirmed non-refunded ticket count vs effective draw threshold;
 * when no positive threshold, require at least one ticket.
 */
function drawThresholdMetForLeaderboard(r: LeaderboardRaffleRow, soldTickets: number): boolean {
  const prize_type: Raffle['prize_type'] = (r.prize_type || '').toLowerCase() === 'nft' ? 'nft' : 'crypto'
  const minParsed = r.min_tickets == null ? null : Number(r.min_tickets)
  const slice = {
    prize_type,
    min_tickets: minParsed != null && Number.isFinite(minParsed) ? minParsed : null,
    floor_price: r.floor_price,
    ticket_price: r.ticket_price,
  } as Pick<Raffle, 'prize_type' | 'min_tickets' | 'floor_price' | 'ticket_price'>
  const min = getEffectiveDrawThresholdTickets(slice as Raffle)
  if (min != null && min > 0) {
    return soldTickets >= min
  }
  return soldTickets > 0
}

function raffleQualifiesForThresholdLeaderboardAggregates(r: LeaderboardRaffleRow, soldTickets: number): boolean {
  if (!raffleCountsTowardLeaderboard(r)) return false
  if (isLeaderboardExcludedByStatusThreshold(r.status)) return false
  return drawThresholdMetForLeaderboard(r, soldTickets)
}

function raffleQualifiesForLegacyLeaderboardAggregates(r: LeaderboardRaffleRow): boolean {
  if (!raffleCountsTowardLeaderboard(r)) return false
  if (isFailedRefundOnlyLeaderboardExcluded(r.status)) return false
  return true
}

/** First UTC calendar month where threshold rules apply (`YYYY-MM`). Invalid/unset uses default (May 2026). */
function parseLeaderboardNewRulesEffectiveYm(): { year: number; month: number } {
  const raw = process.env.LEADERBOARD_NEW_RULES_EFFECTIVE_MONTH?.trim()
  const fallback = { year: 2026, month: 5 }
  if (!raw) return fallback
  const m = /^(\d{4})-(\d{2})$/.exec(raw)
  if (!m) return fallback
  const year = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return fallback
  return { year, month }
}

function compareUtcYearMonth(y1: number, m1: number, y2: number, m2: number): number {
  if (y1 !== y2) return y1 - y2
  return m1 - m2
}

/**
 * Which aggregation rules apply. All-time stays **legacy** so historic totals stay comparable.
 * Month: threshold from the effective month forward (UTC).
 * Year: legacy for calendar years that start entirely before the effective month in the same year as cutover (see code).
 */
export function leaderboardRollupModeForPeriod(period: LeaderboardPeriod): LeaderboardRulesMode {
  const cut = parseLeaderboardNewRulesEffectiveYm()

  if (period.kind === 'all') return 'legacy'

  if (period.kind === 'month') {
    return compareUtcYearMonth(period.year, period.month, cut.year, cut.month) >= 0 ? 'threshold' : 'legacy'
  }

  if (period.year < cut.year) return 'legacy'
  if (period.year > cut.year) return 'threshold'
  return 1 < cut.month ? 'legacy' : 'threshold'
}

function buildExcludedRaffleIds(
  raffles: LeaderboardRaffleRow[],
  mode: LeaderboardRulesMode,
  ticketTotalsByRaffleId: Map<string, number>
): Set<string> {
  const excluded = new Set<string>()
  for (const r of raffles) {
    if (mode === 'legacy') {
      if (!raffleQualifiesForLegacyLeaderboardAggregates(r)) excluded.add(r.id)
    } else {
      const sold = ticketTotalsByRaffleId.get(r.id) ?? 0
      if (!raffleQualifiesForThresholdLeaderboardAggregates(r, sold)) excluded.add(r.id)
    }
  }
  return excluded
}

function parseTimeMs(iso: string | null | undefined): number | null {
  if (iso == null || iso === '') return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : null
}

function entryRankingTimeMs(e: LeaderboardEntryRow): number {
  return parseTimeMs(e.verified_at) ?? parseTimeMs(e.created_at) ?? 0
}

function inUtcWindow(iso: string | null | undefined, window: TimeWindow): boolean {
  const t = parseTimeMs(iso)
  if (t === null) return false
  const start = parseTimeMs(window.startIso)!
  const end = parseTimeMs(window.endIso)!
  return t >= start && t < end
}

async function fetchAllLeaderboardRaffles(db: SupabaseClient): Promise<LeaderboardRaffleRow[]> {
  const rows: LeaderboardRaffleRow[] = []
  let from = 0
  for (;;) {
    const { data, error } = await db
      .from('raffles')
      .select(
        'id, created_by, creator_wallet, winner_wallet, status, created_at, winner_selected_at, ticket_price, currency, alternate_ticket_currency, alternate_ticket_price, prize_type, min_tickets, floor_price'
      )
      .order('id', { ascending: true })
      .range(from, from + LEADERBOARD_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const chunk = (data || []) as LeaderboardRaffleRow[]
    rows.push(...chunk)
    if (chunk.length < LEADERBOARD_PAGE_SIZE) break
    from += LEADERBOARD_PAGE_SIZE
  }
  return rows
}

async function fetchAllConfirmedEntriesForLeaderboard(db: SupabaseClient, window: TimeWindow | null): Promise<LeaderboardEntryRow[]> {
  if (!window) {
    const rows: LeaderboardEntryRow[] = []
    let from = 0
    for (;;) {
      const { data, error } = await db
        .from('entries')
        .select(
          'id, raffle_id, wallet_address, ticket_quantity, verified_at, created_at, amount_paid, refunded_at, referral_complimentary'
        )
        .eq('status', 'confirmed')
        .order('id', { ascending: true })
        .range(from, from + LEADERBOARD_PAGE_SIZE - 1)
      if (error) throw new Error(error.message)
      const chunk = (data || []) as LeaderboardEntryRow[]
      rows.push(...chunk)
      if (chunk.length < LEADERBOARD_PAGE_SIZE) break
      from += LEADERBOARD_PAGE_SIZE
    }
    return rows
  }

  const { startIso, endIso } = window
  const byId = new Map<string, LeaderboardEntryRow>()

  let fromA = 0
  for (;;) {
    const { data, error } = await db
      .from('entries')
      .select(
        'id, raffle_id, wallet_address, ticket_quantity, verified_at, created_at, amount_paid, refunded_at, referral_complimentary'
      )
      .eq('status', 'confirmed')
      .not('verified_at', 'is', null)
      .gte('verified_at', startIso)
      .lt('verified_at', endIso)
      .order('id', { ascending: true })
      .range(fromA, fromA + LEADERBOARD_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const chunk = (data || []) as LeaderboardEntryRow[]
    for (const row of chunk) byId.set(row.id, row)
    if (chunk.length < LEADERBOARD_PAGE_SIZE) break
    fromA += LEADERBOARD_PAGE_SIZE
  }

  let fromB = 0
  for (;;) {
    const { data, error } = await db
      .from('entries')
      .select(
        'id, raffle_id, wallet_address, ticket_quantity, verified_at, created_at, amount_paid, refunded_at, referral_complimentary'
      )
      .eq('status', 'confirmed')
      .is('verified_at', null)
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .order('id', { ascending: true })
      .range(fromB, fromB + LEADERBOARD_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const chunk = (data || []) as LeaderboardEntryRow[]
    for (const row of chunk) byId.set(row.id, row)
    if (chunk.length < LEADERBOARD_PAGE_SIZE) break
    fromB += LEADERBOARD_PAGE_SIZE
  }

  return [...byId.values()]
}

/** Confirmed, non-refunded ticket quantities per raffle (aligns with {@link calculateTicketsSold} in raffles). */
function buildTicketTotalsForDrawThreshold(entries: Iterable<LeaderboardEntryRow>): Map<string, number> {
  const totals = new Map<string, number>()
  for (const e of entries) {
    if (e.refunded_at != null && String(e.refunded_at).trim() !== '') continue
    const q = Number(e.ticket_quantity)
    if (!Number.isFinite(q) || q < 0) continue
    totals.set(e.raffle_id, (totals.get(e.raffle_id) ?? 0) + q)
  }
  return totals
}

async function fetchAllConfirmedTicketTotalsForDrawThreshold(db: SupabaseClient): Promise<Map<string, number>> {
  const totals = new Map<string, number>()
  let from = 0
  for (;;) {
    const { data, error } = await db
      .from('entries')
      .select('raffle_id, ticket_quantity, refunded_at')
      .eq('status', 'confirmed')
      .order('id', { ascending: true })
      .range(from, from + LEADERBOARD_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const chunk = (data || []) as Pick<LeaderboardEntryRow, 'raffle_id' | 'ticket_quantity' | 'refunded_at'>[]
    for (const e of chunk) {
      if (e.refunded_at != null && String(e.refunded_at).trim() !== '') continue
      const q = Number(e.ticket_quantity)
      if (!Number.isFinite(q) || q < 0) continue
      totals.set(e.raffle_id, (totals.get(e.raffle_id) ?? 0) + q)
    }
    if (chunk.length < LEADERBOARD_PAGE_SIZE) break
    from += LEADERBOARD_PAGE_SIZE
  }
  return totals
}

function aggregateLeaderboard(
  raffles: LeaderboardRaffleRow[],
  entries: LeaderboardEntryRow[],
  window: TimeWindow | null,
  ticketTotalsByRaffleId: Map<string, number>,
  mode: LeaderboardRulesMode
): LeaderboardData {
  const excludedRaffleIds = buildExcludedRaffleIds(raffles, mode, ticketTotalsByRaffleId)

  // Raffles entered: distinct raffle count per wallet (entries already scoped)
  const enteredByWallet = new Map<string, Set<string>>()
  for (const e of entries) {
    if (excludedRaffleIds.has(e.raffle_id)) continue
    if (!entryQualifiesForPlayerLeaderboard(e)) continue
    const w = normalizeWallet(e.wallet_address)
    if (!w || leaderboardWalletIsExcluded(w)) continue
    let set = enteredByWallet.get(w)
    if (!set) {
      set = new Set()
      enteredByWallet.set(w, set)
    }
    set.add(e.raffle_id)
  }
  const rafflesEntered = takeTopTen(
    Array.from(enteredByWallet.entries()).map(([wallet, set]) => ({
      wallet,
      value: set.size,
    }))
  )

  const purchaseCapPerRaffle = leaderboardPurchaseMaxTicketsPerWalletPerRaffle()
  const purchaseRows = entries
    .filter((e) => !excludedRaffleIds.has(e.raffle_id) && entryQualifiesForPlayerLeaderboard(e))
    .sort((a, b) => {
      const dt = entryRankingTimeMs(a) - entryRankingTimeMs(b)
      if (dt !== 0) return dt
      return a.id.localeCompare(b.id)
    })
  const purchasedByWallet = new Map<string, number>()
  const purchasedWalletRaffleTotal = new Map<string, number>()
  for (const e of purchaseRows) {
    const w = normalizeWallet(e.wallet_address)
    if (!w || leaderboardWalletIsExcluded(w)) continue
    const qty = Number(e.ticket_quantity)
    if (!Number.isFinite(qty) || qty < 0) continue
    const wrKey = `${w}\t${e.raffle_id}`
    const usedhere = purchasedWalletRaffleTotal.get(wrKey) ?? 0
    const headroom =
      purchaseCapPerRaffle === Number.POSITIVE_INFINITY ? qty : Math.max(0, purchaseCapPerRaffle - usedhere)
    const add = Math.min(qty, headroom)
    if (add <= 0) continue
    purchasedWalletRaffleTotal.set(wrKey, usedhere + add)
    purchasedByWallet.set(w, (purchasedByWallet.get(w) ?? 0) + add)
  }
  const ticketsPurchased = takeTopTen(
    Array.from(purchasedByWallet.entries()).map(([wallet, value]) => ({ wallet, value }))
  )

  const createdByWallet = new Map<string, number>()
  for (const r of raffles) {
    if (excludedRaffleIds.has(r.id)) continue
    if (window && !inUtcWindow(r.created_at, window)) continue
    const w = normalizeWallet(r.creator_wallet ?? r.created_by)
    if (!w || leaderboardWalletIsExcluded(w)) continue
    createdByWallet.set(w, (createdByWallet.get(w) ?? 0) + 1)
  }
  const rafflesCreated = takeTopTen(
    Array.from(createdByWallet.entries()).map(([wallet, value]) => ({ wallet, value }))
  )

  const raffleToCreator = new Map<string, string>()
  for (const r of raffles) {
    const w = normalizeWallet(r.creator_wallet ?? r.created_by)
    if (w) raffleToCreator.set(r.id, w)
  }

  /** Raffles whose volume counts toward Tickets sold leaderboard (anti self-farm / low-buyer washes). */
  const minDistinctBuyers = leaderboardTicketsSoldMinDistinctNonCreatorBuyers()
  const distinctNonCreatorByRaffle = new Map<string, Set<string>>()
  for (const e of entries) {
    if (excludedRaffleIds.has(e.raffle_id)) continue
    if (!entryQualifiesForPlayerLeaderboard(e)) continue
    const creator = raffleToCreator.get(e.raffle_id)
    if (!creator) continue
    const w = normalizeWallet(e.wallet_address)
    if (!w || w === creator) continue
    let set = distinctNonCreatorByRaffle.get(e.raffle_id)
    if (!set) {
      set = new Set()
      distinctNonCreatorByRaffle.set(e.raffle_id, set)
    }
    set.add(w)
  }
  const raffleEligibleForSoldLeaderboard = new Set<string>()
  for (const [rid, wallets] of distinctNonCreatorByRaffle) {
    if (wallets.size >= minDistinctBuyers) raffleEligibleForSoldLeaderboard.add(rid)
  }

  const ticketsByCreator = new Map<string, number>()
  for (const e of entries) {
    if (excludedRaffleIds.has(e.raffle_id)) continue
    if (!raffleEligibleForSoldLeaderboard.has(e.raffle_id)) continue
    if (!entryQualifiesForPlayerLeaderboard(e)) continue
    const creator = raffleToCreator.get(e.raffle_id)
    if (!creator || leaderboardWalletIsExcluded(creator)) continue
    const buyer = normalizeWallet(e.wallet_address)
    if (!buyer || buyer === creator) continue
    const qty = Number(e.ticket_quantity)
    if (!Number.isFinite(qty) || qty < 0) continue
    ticketsByCreator.set(creator, (ticketsByCreator.get(creator) ?? 0) + qty)
  }
  const ticketsSold = takeTopTen(
    Array.from(ticketsByCreator.entries()).map(([wallet, value]) => ({ wallet, value }))
  )

  const winsByWallet = new Map<string, number>()
  for (const r of raffles) {
    if (raffleStatusExcludedFromWinsLeaderboard(r.status, mode)) continue
    const winner = normalizeWallet(r.winner_wallet)
    if (!winner || leaderboardWalletIsExcluded(winner)) continue
    if (!statusCountsAsRaffleWon(r.status)) continue
    if (window) {
      if (!inUtcWindow(r.winner_selected_at, window)) continue
    }
    winsByWallet.set(winner, (winsByWallet.get(winner) ?? 0) + 1)
  }
  const rafflesWon = takeTopTen(
    Array.from(winsByWallet.entries()).map(([wallet, value]) => ({ wallet, value }))
  )

  return {
    rafflesEntered,
    ticketsPurchased,
    rafflesCreated,
    ticketsSold,
    rafflesWon,
  }
}

/**
 * All-time top 10 (legacy helper).
 */
export async function getLeaderboardTopTen(): Promise<LeaderboardData> {
  const { leaderboard } = await getLeaderboardWithMeta({ kind: 'all' })
  return leaderboard
}

export async function getLeaderboardWithMeta(period: LeaderboardPeriod): Promise<{
  leaderboard: LeaderboardData
  period: LeaderboardPeriodMeta
}> {
  const db = getSupabaseAdmin()
  const window = periodToWindow(period)
  const rulesMode = leaderboardRollupModeForPeriod(period)
  const meta: LeaderboardPeriodMeta = {
    ...buildLeaderboardPeriodMeta(period),
    leaderboardRules: rulesMode,
    minTicketPriceSol: leaderboardMinTicketPriceSol(),
  }

  const needThresholdTicketScan = rulesMode === 'threshold' && window != null

  const [raffles, entries, thresholdTotalsFullScan] = await Promise.all([
    fetchAllLeaderboardRaffles(db),
    fetchAllConfirmedEntriesForLeaderboard(db, window),
    needThresholdTicketScan ? fetchAllConfirmedTicketTotalsForDrawThreshold(db) : Promise.resolve(null),
  ])

  const ticketTotalsByRaffleId =
    rulesMode === 'threshold'
      ? thresholdTotalsFullScan ?? buildTicketTotalsForDrawThreshold(entries)
      : new Map<string, number>()

  const leaderboard = aggregateLeaderboard(raffles, entries, window, ticketTotalsByRaffleId, rulesMode)
  return { leaderboard, period: meta }
}
