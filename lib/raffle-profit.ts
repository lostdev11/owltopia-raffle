import type { Raffle, Entry } from '@/lib/types'

export type RaffleCurrency = 'SOL' | 'USDC' | 'OWL'

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
 * 1) Explicit prize_amount / prize_currency when set and positive (non-NFT / crypto prizes only).
 * 2) When min_tickets is set: min_tickets * ticket_price in raffle.currency (so "Draw Threshold: 80"
 *    tickets at 1 USDC each = 80 USDC revenue threshold).
 * 3) Else: floor_price in raffle.currency (e.g. NFT prize value).
 */
export function getRaffleThreshold(raffle: Raffle): { value: number; currency: RaffleCurrency } | null {
  // 1) Explicit prize_amount / prize_currency for non-NFT (crypto cash prizes). NFT raffles always use floor_price.
  if ((raffle.prize_type || '').toLowerCase() !== 'nft') {
    const amount = raffle.prize_amount != null ? Number(raffle.prize_amount) : NaN
    const currency = (raffle.prize_currency || raffle.currency || '').toUpperCase()
    if (Number.isFinite(amount) && amount > 0 && (currency === 'SOL' || currency === 'USDC' || currency === 'OWL')) {
      return { value: amount, currency: currency as RaffleCurrency }
    }
  }

  // 2) For crypto raffles: draw threshold in revenue = min_tickets * ticket_price
  const minTickets = raffle.min_tickets != null ? Number(raffle.min_tickets) : NaN
  const ticketPrice = raffle.ticket_price != null ? Number(raffle.ticket_price) : NaN
  const cur = (raffle.currency || 'SOL').toUpperCase()
  const isCrypto = raffle.prize_type === 'crypto'
  if (isCrypto && Number.isFinite(minTickets) && minTickets > 0 && Number.isFinite(ticketPrice) && ticketPrice > 0 && (cur === 'SOL' || cur === 'USDC' || cur === 'OWL')) {
    return { value: minTickets * ticketPrice, currency: cur as RaffleCurrency }
  }

  // 3) Default: floor_price in raffle.currency (prize value = floor price, e.g. NFT)
  const rawFloor = raffle.floor_price
  if (rawFloor != null && String(rawFloor).trim() !== '') {
    const fp = parseFloat(String(rawFloor).trim())
    if (Number.isFinite(fp) && fp >= 0) {
      const fc = (raffle.currency || 'SOL').toUpperCase()
      if (fc === 'SOL' || fc === 'USDC' || fc === 'OWL') {
        return { value: fp, currency: fc as RaffleCurrency }
      }
    }
  }

  return null
}

/**
 * Revenue in a specific currency (from RaffleRevenue).
 */
function revenueInCurrency(revenue: RaffleRevenue, currency: RaffleCurrency): number {
  switch (currency) {
    case 'USDC': return revenue.usdc
    case 'SOL': return revenue.sol
    case 'OWL': return revenue.owl
    default: return 0
  }
}

/**
 * Compute profitability for a raffle from its entries.
 * Profitable when revenue (in threshold currency) > threshold.
 */
export function getRaffleProfitInfo(raffle: Raffle, entries: Entry[]): RaffleProfitInfo {
  const revenue = getRaffleRevenue(entries)
  const th = getRaffleThreshold(raffle)
  if (!th) {
    return {
      revenue,
      threshold: null,
      thresholdCurrency: null,
      isProfitable: false,
    }
  }
  const revenueInThreshold = revenueInCurrency(revenue, th.currency)
  const isProfitable = revenueInThreshold > th.value
  return {
    revenue,
    threshold: th.value,
    thresholdCurrency: th.currency,
    isProfitable,
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
  const profit = Math.max(0, revInCur - th.value)
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
