import type { Raffle, Entry } from '@/lib/types'
import {
  getEffectiveDrawThresholdTickets,
  lenientParseNftFloorAmount,
  parseNftFloorPrice,
} from '@/lib/raffles/nft-raffle-economics'

export type RaffleCurrency = 'SOL' | 'USDC' | 'OWL'

/**
 * Canonical ticket currency for comparisons and revenue display.
 * DB/API may return mixed case; strict `=== 'USDC'` checks would otherwise read the wrong revenue bucket.
 */
export function normalizeRaffleTicketCurrency(input: string | null | undefined): RaffleCurrency {
  const c = String(input ?? 'SOL').trim().toUpperCase()
  if (c === 'SOL' || c === 'USDC' || c === 'OWL') return c
  return 'SOL'
}

export interface RaffleRevenue {
  usdc: number
  sol: number
  owl: number
}

export interface RaffleProfitInfo {
  revenue: RaffleRevenue
  /** Break-even cost (prize value). Revenue above this = profitable. */
  threshold: number | null
  thresholdCurrency: RaffleCurrency | null
  isProfitable: boolean
  /**
   * Surplus shown as “Amount over threshold” in the raffle UI.
   * Uses the same decimal rounding as the UI (USDC 2dp, SOL/OWL 4dp) so float noise
   * does not show a false “+” when revenue and the bar match in practice (e.g. ticket sum vs min×price).
   */
  surplusOverThreshold: number | null
  /**
   * Parsed numeric value from `floor_price` (listed prize value) in {@link floorComparisonCurrency}, when parseable.
   * Unlike {@link threshold}, this is **not** merged with draw-goal revenue.
   */
  floorComparisonValue: number | null
  floorComparisonCurrency: RaffleCurrency | null
  /** True when ticket revenue in {@link floorComparisonCurrency} is strictly greater than {@link floorComparisonValue}. */
  isRevenueAboveFloor: boolean
  /** Surplus past listed floor only (null if no floor or not above). */
  surplusOverFloor: number | null
}

/**
 * Public “flex” badge / showcase: prefer **above listed floor** when `floor_price` parses; otherwise composite threshold {@link isProfitable}.
 */
export function shouldShowRevenueFlexPublic(profitInfo: RaffleProfitInfo): boolean {
  if (profitInfo.floorComparisonValue != null && profitInfo.floorComparisonCurrency != null) {
    return profitInfo.isRevenueAboveFloor
  }
  return profitInfo.isProfitable
}

/** Generated flex PNG chip text (uppercase). */
export function revenueFlexPromoChipUppercase(profitInfo: RaffleProfitInfo): string {
  if (profitInfo.floorComparisonValue != null && profitInfo.floorComparisonCurrency != null) {
    return 'ABOVE FLOOR'
  }
  return 'OVER THRESHOLD'
}

/**
 * Listed floor from `floor_price` (ticket currency); null if unset or unparsable.
 */
export function getRaffleListedFloorForComparison(
  raffle: Raffle
): { value: number; currency: RaffleCurrency } | null {
  const floorN = lenientParseNftFloorAmount(raffle.floor_price)
  if (floorN == null || floorN <= 0) return null
  const cur = normalizeRaffleTicketCurrency(raffle.currency)
  return { value: floorN, currency: cur }
}

function computeFloorComparisonProfit(
  raffle: Raffle,
  revenue: RaffleRevenue
): Pick<
  RaffleProfitInfo,
  'floorComparisonValue' | 'floorComparisonCurrency' | 'isRevenueAboveFloor' | 'surplusOverFloor'
> {
  const fb = getRaffleListedFloorForComparison(raffle)
  if (!fb) {
    return {
      floorComparisonValue: null,
      floorComparisonCurrency: null,
      isRevenueAboveFloor: false,
      surplusOverFloor: null,
    }
  }
  const revenueInCur = revenueInCurrency(revenue, fb.currency)
  const rRounded = roundForProfitDisplay(revenueInCur, fb.currency)
  const fRounded = roundForProfitDisplay(fb.value, fb.currency)
  const isRevenueAboveFloor = rRounded > fRounded
  const surplusOverFloor =
    fRounded > 0 && rRounded > fRounded ? roundForProfitDisplay(rRounded - fRounded, fb.currency) : null
  return {
    floorComparisonValue: fb.value,
    floorComparisonCurrency: fb.currency,
    isRevenueAboveFloor,
    surplusOverFloor,
  }
}

/** Aligns with raffle detail display: USDC 2 decimals, SOL/OWL 4. */
function roundForProfitDisplay(n: number, currency: RaffleCurrency): number {
  const decimals = currency === 'USDC' ? 2 : 4
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

/**
 * Sum confirmed entry payments by currency for a raffle.
 */
export function getRaffleRevenue(entries: Entry[]): RaffleRevenue {
  const confirmed = entries.filter(e => e.status === 'confirmed')
  let usdc = 0
  let sol = 0
  let owl = 0
  for (const e of confirmed) {
    const amount = Number(e.amount_paid) || 0
    const c = (e.currency || '').toUpperCase()
    if (c === 'USDC') usdc += amount
    else if (c === 'SOL') sol += amount
    else if (c === 'OWL') owl += amount
  }
  return { usdc, sol, owl }
}

/**
 * Get the profit threshold for a raffle (cost to cover).
 *
 * Used for **display** (revenue vs bar, rev-share hints) and {@link getRaffleProfitInfo}. It does **not**
 * gate creator/winner claims or whether a draw may run — those use raffle status, escrow rules, and
 * confirmed **ticket count** vs {@link getEffectiveDrawThresholdTickets} (see `canSelectWinner` in `lib/db/raffles.ts`).
 *
 * 1) Explicit prize_amount / prize_currency when set and positive (non-NFT / crypto prizes only).
 * 2) NFT: max of (effective draw goal × ticket_price) and lenient-parsed floor — aligns the bar with the
 *    same effective min tickets as draw eligibility when that binding part is higher than floor alone.
 * 3) Crypto: min_tickets * ticket_price when set.
 * 4) Else: floor_price text (legacy / edge cases).
 */
export function getRaffleThreshold(raffle: Raffle): { value: number; currency: RaffleCurrency } | null {
  // 1) Explicit prize_amount / prize_currency for non-NFT (crypto cash prizes).
  if ((raffle.prize_type || '').toLowerCase() !== 'nft') {
    const amount = raffle.prize_amount != null ? Number(raffle.prize_amount) : NaN
    const currency = (raffle.prize_currency || raffle.currency || '').toUpperCase()
    if (Number.isFinite(amount) && amount > 0 && (currency === 'SOL' || currency === 'USDC' || currency === 'OWL')) {
      return { value: amount, currency: currency as RaffleCurrency }
    }
  }

  const cur = (raffle.currency || 'SOL').toUpperCase()
  const currencyOk = cur === 'SOL' || cur === 'USDC' || cur === 'OWL'
  if (!currencyOk) return null

  // 2) NFT: revenue bar tracks draw goal (effective min tickets × ticket) and floor, whichever is higher.
  if ((raffle.prize_type || '').toLowerCase() === 'nft') {
    const ticketPrice = raffle.ticket_price != null ? Number(raffle.ticket_price) : NaN
    const effectiveMin = getEffectiveDrawThresholdTickets(raffle)
    let drawGoalRevenue = NaN
    if (effectiveMin != null && effectiveMin > 0 && Number.isFinite(ticketPrice) && ticketPrice > 0) {
      drawGoalRevenue = effectiveMin * ticketPrice
    }
    const floorN = lenientParseNftFloorAmount(raffle.floor_price)
    const floorVal = floorN != null && floorN > 0 ? floorN : NaN
    const parts: number[] = []
    if (Number.isFinite(drawGoalRevenue) && drawGoalRevenue > 0) parts.push(drawGoalRevenue)
    if (Number.isFinite(floorVal) && floorVal > 0) parts.push(floorVal)
    if (parts.length === 0) return null
    return { value: Math.max(...parts), currency: cur as RaffleCurrency }
  }

  // 3) Crypto: draw threshold in revenue = min_tickets * ticket_price
  const minTickets = raffle.min_tickets != null ? Number(raffle.min_tickets) : NaN
  const ticketPrice = raffle.ticket_price != null ? Number(raffle.ticket_price) : NaN
  const isCrypto = raffle.prize_type === 'crypto'
  if (isCrypto && Number.isFinite(minTickets) && minTickets > 0 && Number.isFinite(ticketPrice) && ticketPrice > 0) {
    return { value: minTickets * ticketPrice, currency: cur as RaffleCurrency }
  }

  // 4) Default: floor_price in raffle.currency
  const rawFloor = raffle.floor_price
  if (rawFloor != null && String(rawFloor).trim() !== '') {
    const fp = parseFloat(String(rawFloor).trim())
    if (Number.isFinite(fp) && fp >= 0) {
      return { value: fp, currency: cur as RaffleCurrency }
    }
  }

  return null
}

/** Draft fields from the create-raffle form — used only for {@link previewCreateRaffleThreshold}. */
export type CreateRaffleThresholdDraft = {
  prizeMode: 'nft' | 'token'
  ticketCurrency: string
  /** Parsed positive ticket price, or null if invalid / empty. */
  ticketPrice: number | null
  floorPriceInput: string
  partnerMinTickets: number | null
  partnerPrizeAmount: number | null
  partnerPrizeCurrency: string
}

/**
 * Same bar as {@link getRaffleThreshold} after save, computed from live form values (no DB row).
 */
export function previewCreateRaffleThreshold(draft: CreateRaffleThresholdDraft): {
  value: number
  currency: RaffleCurrency
} | null {
  const cur = normalizeRaffleTicketCurrency(draft.ticketCurrency)
  const tp = draft.ticketPrice
  if (tp == null || !Number.isFinite(tp) || tp <= 0) return null

  if (draft.prizeMode === 'nft') {
    const floorParsed = parseNftFloorPrice(draft.floorPriceInput)
    if (!floorParsed.ok) return null
    const synthetic = {
      prize_type: 'nft',
      currency: cur,
      ticket_price: tp,
      floor_price: floorParsed.string,
      min_tickets: null,
      prize_amount: null,
      prize_currency: null,
    } as Raffle
    return getRaffleThreshold(synthetic)
  }

  const amt = draft.partnerPrizeAmount
  const prizeAmt =
    amt != null && Number.isFinite(amt) && amt > 0 ? amt : null
  const prizeCur = (draft.partnerPrizeCurrency || '').trim().toUpperCase() || null
  const floorTrim = draft.floorPriceInput.trim()
  const synthetic = {
    prize_type: 'crypto',
    currency: cur,
    ticket_price: tp,
    floor_price: floorTrim || null,
    min_tickets: draft.partnerMinTickets,
    prize_amount: prizeAmt,
    prize_currency: prizeCur,
  } as Raffle
  return getRaffleThreshold(synthetic)
}

/**
 * Ticket gross in one bucket (from {@link getRaffleRevenue}).
 * Use the raffle’s **ticket** currency for display; the profit threshold may use
 * {@link getRaffleThreshold}’s currency (e.g. SOL prize on a USDC-ticket raffle).
 */
export function revenueInCurrency(revenue: RaffleRevenue, currency: RaffleCurrency): number {
  switch (currency) {
    case 'USDC': return revenue.usdc
    case 'SOL': return revenue.sol
    case 'OWL': return revenue.owl
    default: return 0
  }
}

/**
 * Compute profitability for a raffle from its entries.
 * `isProfitable` is true when rounded display revenue (in threshold currency) is **strictly greater** than
 * the rounded threshold — avoids IEEE float glitches vs {@link getRaffleThreshold}’s `minTickets * ticket_price`.
 * Claims and draws do not read this; see {@link getRaffleThreshold}.
 */
export function getRaffleProfitInfo(raffle: Raffle, entries: Entry[]): RaffleProfitInfo {
  const revenue = getRaffleRevenue(entries)
  const floorPart = computeFloorComparisonProfit(raffle, revenue)
  const th = getRaffleThreshold(raffle)
  if (!th) {
    return {
      revenue,
      threshold: null,
      thresholdCurrency: null,
      isProfitable: false,
      surplusOverThreshold: null,
      ...floorPart,
    }
  }
  const revenueInThreshold = revenueInCurrency(revenue, th.currency)
  const rRounded = roundForProfitDisplay(revenueInThreshold, th.currency)
  const tRounded = roundForProfitDisplay(th.value, th.currency)
  const isProfitable = rRounded > tRounded
  const surplusOverThreshold =
    tRounded > 0 && rRounded > tRounded
      ? roundForProfitDisplay(rRounded - tRounded, th.currency)
      : null
  return {
    revenue,
    threshold: th.value,
    thresholdCurrency: th.currency,
    isProfitable,
    surplusOverThreshold,
    ...floorPart,
  }
}

export interface RevShareAmounts {
  founderSol: number
  founderUsdc: number
  communitySol: number
  communityUsdc: number
}

/**
 * Rev share (50% founder / 50% community) in SOL and USDC for display.
 * Profit is only in the raffle's threshold currency; other currency amounts are 0.
 */
export function getRevShareAmounts(raffle: Raffle, entries: Entry[]): RevShareAmounts {
  const revenue = getRaffleRevenue(entries)
  const th = getRaffleThreshold(raffle)
  const out: RevShareAmounts = { founderSol: 0, founderUsdc: 0, communitySol: 0, communityUsdc: 0 }
  if (!th || th.currency === 'OWL') return out
  const revInCur = revenueInCurrency(revenue, th.currency)
  const rRounded = roundForProfitDisplay(revInCur, th.currency)
  const tRounded = roundForProfitDisplay(th.value, th.currency)
  const profit = Math.max(0, rRounded - tRounded)
  const half = profit * 0.5
  if (th.currency === 'SOL') {
    out.founderSol = half
    out.communitySol = half
  } else {
    out.founderUsdc = half
    out.communityUsdc = half
  }
  return out
}
