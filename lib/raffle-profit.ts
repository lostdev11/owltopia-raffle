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
 * - Crypto: prize_amount in prize_currency.
 * - NFT: floor_price parsed as number, in raffle.currency.
 * Anything above this threshold = profitable.
 */
export function getRaffleThreshold(raffle: Raffle): { value: number; currency: RaffleCurrency } | null {
  if (raffle.prize_type === 'nft') {
    const fp = raffle.floor_price != null ? parseFloat(String(raffle.floor_price)) : NaN
    if (!Number.isFinite(fp) || fp < 0) return null
    return { value: fp, currency: raffle.currency }
  }
  const amount = raffle.prize_amount != null ? Number(raffle.prize_amount) : NaN
  const currency = (raffle.prize_currency || raffle.currency || '').toUpperCase()
  if (!Number.isFinite(amount) || amount < 0) return null
  if (currency !== 'SOL' && currency !== 'USDC' && currency !== 'OWL') return null
  return { value: amount, currency: currency as RaffleCurrency }
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
