/**
 * Referral anti-abuse (no payouts here — attribution + leaderboard only).
 * Thresholds align with SQL view `referral_leaderboard_v1` (migration 065).
 */

function parsePositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Max rows (pending+confirmed) with any referrer this buyer can create in 24h. */
export function referralMaxBuyerRows24h(): number {
  return parsePositiveInt('REFERRAL_MAX_BUYER_ROWS_24H', 20)
}

/** Max rows (pending+confirmed) attributed to one referrer in 24h (all buyers). */
export function referralMaxReferrerRows24h(): number {
  return parsePositiveInt('REFERRAL_MAX_REFERRER_ROWS_24H', 120)
}

/** Minimum purchase (this checkout) to attach a referrer at all. */
export function referralMinPurchaseByCurrency(currency: string): number {
  const c = currency.trim().toUpperCase()
  if (c === 'SOL') return parseFloatEnv('REFERRAL_MIN_PURCHASE_SOL', 0.02)
  if (c === 'USDC') return parseFloatEnv('REFERRAL_MIN_PURCHASE_USDC', 1)
  if (c === 'OWL') return parseFloatEnv('REFERRAL_MIN_PURCHASE_OWL', 10)
  return Number.POSITIVE_INFINITY
}

function parseFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function purchaseMeetsReferralMinimum(currency: string, amountPaid: number): boolean {
  const min = referralMinPurchaseByCurrency(currency)
  if (!Number.isFinite(amountPaid) || amountPaid <= 0) return false
  return amountPaid >= min
}
