/**
 * Leaderboard rules: creator-set `ticket_price` floors (per currency), entry hygiene, purchase caps, tickets-sold buyers.
 * Founder/treasury wallets do not appear in leaderboard rankings (entered, purchased, created, wins).
 * Purchases by those wallets still count toward creators’ tickets-sold totals and distinct-buyer thresholds.
 * Optional `LEADERBOARD_EXCLUDED_WALLETS` adds more (comma-separated).
 * Referral program uses separate thresholds (lib/referrals/hardening.ts).
 */

/** Owltopia founder + treasury wallets: never appear on public leaderboard (base58, exact string match after trim). */
const LEADERBOARD_EXCLUDED_BUILTIN: readonly string[] = [
  'FuknitCEim3gKsYAMnnqGD3MxnhrMecAWFPLjkZRaTHn',
  '7gra2JyY969Lt3BXLb6FMx9DxouXcEpRzpiKnc6wFgrq',
  'qg7pNNZq7qDQuc6Xkd1x4NvS2VM3aHtCqHEzucZxRGA',
  // Launchpad + staking platform fee treasury
  '7YxQg8HkwvH1L6iuY28JNWzJ96GWEx4qD8CK4M6nYkAY',
]

let excludedWalletSetCache: ReadonlySet<string> | null = null

/**
 * Wallets built-in (founders/treasury) plus `LEADERBOARD_EXCLUDED_WALLETS` (comma or whitespace separated).
 */
export function leaderboardExcludedWalletSet(): ReadonlySet<string> {
  if (excludedWalletSetCache) return excludedWalletSetCache
  const fromEnv = (process.env.LEADERBOARD_EXCLUDED_WALLETS ?? '')
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  excludedWalletSetCache = new Set([...LEADERBOARD_EXCLUDED_BUILTIN, ...fromEnv])
  return excludedWalletSetCache
}

export function leaderboardWalletIsExcluded(wallet: string | null | undefined): boolean {
  const w = typeof wallet === 'string' ? wallet.trim() : ''
  if (!w) return false
  return leaderboardExcludedWalletSet().has(w)
}

/** Same ratios as referral anti-dust (0.02 SOL : 1 USDC : 10 OWL) for default USDC/OWL floors from SOL. */
const REF_SOL = 0.02
const REF_USDC = 1
const REF_OWL = 10

function parseFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function parsePositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * Minimum ticket price (raffle field `ticket_price`) in SOL: raffles with price **≤** this are excluded from leaderboards.
 * Eligibility uses **strict** `ticket_price >` this value, so default 0.0001 excludes 0.0001 SOL raffles.
 */
export function leaderboardMinTicketPriceSol(): number {
  return parseFloatEnv('LEADERBOARD_MIN_TICKET_PRICE_SOL', 0.0001)
}

function defaultMinTicketUsdcFromSol(): number {
  return (leaderboardMinTicketPriceSol() / REF_SOL) * REF_USDC
}

function defaultMinTicketOwlFromSol(): number {
  return (leaderboardMinTicketPriceSol() / REF_SOL) * REF_OWL
}

function defaultMinTicketBambooFromSol(): number {
  return (leaderboardMinTicketPriceSol() / REF_SOL) * REF_OWL
}

export function leaderboardMinTicketPriceForCurrency(currency: string): number {
  const c = currency.trim().toUpperCase() || 'SOL'
  if (c === 'SOL') return leaderboardMinTicketPriceSol()
  if (c === 'USDC') return parseFloatEnv('LEADERBOARD_MIN_TICKET_PRICE_USDC', defaultMinTicketUsdcFromSol())
  if (c === 'OWL') return parseFloatEnv('LEADERBOARD_MIN_TICKET_PRICE_OWL', defaultMinTicketOwlFromSol())
  if (c === 'BAMBOO') {
    return parseFloatEnv('LEADERBOARD_MIN_TICKET_PRICE_BAMBOO', defaultMinTicketBambooFromSol())
  }
  return Number.POSITIVE_INFINITY
}

export type LeaderboardRafflePriceFields = {
  ticket_price: number | string | null
  currency?: string | null
  /** SOL↔BAMBOO dual-ticket raffles (migration 114). */
  alternate_ticket_currency?: string | null
  alternate_ticket_price?: number | string | null
}

function ticketPriceAboveFloor(currency: string, price: number): boolean {
  if (!Number.isFinite(price) || price <= 0) return false
  const min = leaderboardMinTicketPriceForCurrency(currency)
  if (!Number.isFinite(min)) return false
  return price > min
}

/**
 * Raffle counts toward entered / purchased / created / sold when primary or alternate ticket price
 * is above the floor for that line's currency (supports SOL + BAMBOO dual-ticket listings).
 */
export function raffleCountsTowardLeaderboard(r: LeaderboardRafflePriceFields): boolean {
  const primaryCur = `${r.currency ?? 'SOL'}`.trim() || 'SOL'
  const primaryPrice = Number(r.ticket_price)
  if (ticketPriceAboveFloor(primaryCur, primaryPrice)) return true

  const altCur = (r.alternate_ticket_currency ?? '').trim()
  if (!altCur) return false
  const altPrice = Number(r.alternate_ticket_price)
  return ticketPriceAboveFloor(altCur, altPrice)
}

/** Min distinct wallets (excluding creator) with qualifying purchases for a raffle to count toward Tickets sold leaderboard. */
export function leaderboardTicketsSoldMinDistinctNonCreatorBuyers(): number {
  return parsePositiveInt('LEADERBOARD_SOLD_MIN_DISTINCT_BUYERS', 5)
}

/**
 * Max ticket quantity per wallet per raffle that counts toward "Most tickets purchased".
 * Set env to 0 to disable the cap.
 */
export function leaderboardPurchaseMaxTicketsPerWalletPerRaffle(): number {
  const raw = process.env.LEADERBOARD_PURCHASE_MAX_TICKETS_PER_RAFFLE?.trim()
  if (!raw) return 60
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return 60
  if (n <= 0) return Number.POSITIVE_INFINITY
  return n
}

export type LeaderboardEntryPaymentFields = {
  amount_paid: number | string | null
  refunded_at?: string | null
  referral_complimentary?: boolean | null
}

/**
 * Confirmed entries that can count toward player stats (raffle must also pass `raffleCountsTowardLeaderboard`).
 */
export function entryQualifiesForPlayerLeaderboard(e: LeaderboardEntryPaymentFields): boolean {
  if (e.referral_complimentary === true) return false
  if (e.refunded_at != null && String(e.refunded_at).trim() !== '') return false
  const amt = Number(e.amount_paid)
  if (!Number.isFinite(amt) || amt <= 0) return false
  return true
}
