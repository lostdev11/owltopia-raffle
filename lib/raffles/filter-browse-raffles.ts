import type { Raffle, RaffleCurrency } from '@/lib/types'
import { isRaffleCurrency } from '@/lib/tokens'
import { acceptedTicketPaymentCurrencies } from '@/lib/raffles/dual-ticket-payment'

export type RaffleBrowseTicketCurrencyFilter = RaffleCurrency | null

/** Crypto prize paid in SOL or USDC (not ticket currency). */
export type RaffleBrowsePrizeFilter = 'SOL' | 'USDC' | null

export interface RaffleBrowseFilters {
  query: string
  ticketCurrency: RaffleBrowseTicketCurrencyFilter
  prize: RaffleBrowsePrizeFilter
}

/** Parse `?currency=OWL` (ticket payment filter). */
export function ticketCurrencyFilterFromSearchParam(
  raw: string | null | undefined
): RaffleBrowseTicketCurrencyFilter {
  const u = (raw ?? '').trim().toUpperCase()
  if (!u) return null
  return isRaffleCurrency(u) ? u : null
}

/** Parse `?prize=SOL` or `?prize=USDC` (crypto prize filter). */
export function prizeFilterFromSearchParam(
  raw: string | null | undefined
): RaffleBrowsePrizeFilter {
  const u = (raw ?? '').trim().toUpperCase()
  if (u === 'SOL' || u === 'USDC') return u
  return null
}

export function isCryptoPrizeRaffle(raffle: Raffle): boolean {
  return raffle.prize_type === 'crypto' || raffle.prize_type == null
}

function searchableFields(raffle: Raffle): string[] {
  return [
    raffle.title,
    raffle.slug,
    raffle.description,
    raffle.nft_collection_name,
    raffle.nft_token_id,
    raffle.prize_currency,
    raffle.promo_x_handle,
    raffle.creator_wallet,
    raffle.created_by,
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim().toLowerCase())
}

/** Case-insensitive match on title, slug, collection, prize ticker, promo handle, etc. */
export function raffleMatchesBrowseSearch(raffle: Raffle, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase()
  if (!q) return true
  const fields = searchableFields(raffle)
  return fields.some((field) => field.includes(q))
}

/** Matches primary or alternate ticket currency (e.g. SOL + BAMBOO dual). */
export function raffleMatchesTicketCurrencyFilter(
  raffle: Raffle,
  ticketCurrency: RaffleBrowseTicketCurrencyFilter
): boolean {
  if (!ticketCurrency) return true
  return acceptedTicketPaymentCurrencies(raffle).includes(ticketCurrency)
}

/** Crypto prize raffles where {@link Raffle.prize_currency} is SOL or USDC. */
export function raffleMatchesPrizeFilter(
  raffle: Raffle,
  prize: RaffleBrowsePrizeFilter
): boolean {
  if (!prize) return true
  if (!isCryptoPrizeRaffle(raffle)) return false
  const pc = (raffle.prize_currency || '').trim().toUpperCase()
  return pc === prize
}

export function raffleMatchesBrowseFilters(raffle: Raffle, filters: RaffleBrowseFilters): boolean {
  return (
    raffleMatchesBrowseSearch(raffle, filters.query) &&
    raffleMatchesTicketCurrencyFilter(raffle, filters.ticketCurrency) &&
    raffleMatchesPrizeFilter(raffle, filters.prize)
  )
}

export function filterRafflesBrowseList<T extends { raffle: Raffle }>(
  items: T[],
  filters: RaffleBrowseFilters
): T[] {
  if (!filters.query.trim() && !filters.ticketCurrency && !filters.prize) return items
  return items.filter(({ raffle }) => raffleMatchesBrowseFilters(raffle, filters))
}

export function hasActiveBrowseFilters(filters: RaffleBrowseFilters): boolean {
  return Boolean(filters.query.trim() || filters.ticketCurrency || filters.prize)
}
