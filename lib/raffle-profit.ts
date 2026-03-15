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
 * Default: floor_price in raffle.currency (prize value = floor price set on the raffle).
 *
 * Override: when prize_amount is set and > 0, use prize_amount in prize_currency instead
 * (e.g. 80 USDC for a 1 SOL floor NFT when SOL ≈ $80).
 */
export function getRaffleThreshold(raffle: Raffle): { value: number; currency: RaffleCurrency } | null {
  // 1) Explicit prize_amount / prize_currency when set and positive
  const amount = raffle.prize_amount != null ? Number(raffle.prize_amount) : NaN
  const currency = (raffle.prize_currency || raffle.currency || '').toUpperCase()
  if (Number.isFinite(amount) && amount > 0 && (currency === 'SOL' || currency === 'USDC' || currency === 'OWL')) {
    return { value: amount, currency: currency as RaffleCurrency }
  }

  // 2) Default: floor_price in raffle.currency (prize value = floor price)
  const rawFloor = raffle.floor_price
  if (rawFloor != null && String(rawFloor).trim() !== '') {
    const fp = parseFloat(String(rawFloor).trim())
    if (Number.isFinite(fp) && fp >= 0) {
      const cur = (raffle.currency || 'SOL').toUpperCase()
      if (cur === 'SOL' || cur === 'USDC' || cur === 'OWL') {
        return { value: fp, currency: cur as RaffleCurrency }
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
