import type { Raffle, RaffleCurrency } from '@/lib/types'
import { isRaffleCurrency } from '@/lib/tokens'
import { acceptedTicketPaymentCurrencies } from '@/lib/raffles/dual-ticket-payment'
import { getRaffleHostWallet } from '@/lib/raffles/host-wallet-copy'
import {
  normalizeSolanaWalletAddress,
  walletsEqualSolana,
} from '@/lib/solana/normalize-wallet'

export type RaffleBrowseTicketCurrencyFilter = RaffleCurrency | null

/** Crypto prize paid in SOL or USDC (not ticket currency). */
export type RaffleBrowsePrizeFilter = 'SOL' | 'USDC' | null

/**
 * Wallet-backed host filter (`?host=<wallet>`).
 * Display names are resolved in UX only — never stored as the filter identity.
 */
export type RaffleBrowseHostFilter = string | null

/** Collection-mint filter (`?collection=<mint>`). Display names are UX only. */
export type RaffleBrowseCollectionFilter = string | null

export interface RaffleBrowseFilters {
  query: string
  ticketCurrency: RaffleBrowseTicketCurrencyFilter
  prize: RaffleBrowsePrizeFilter
  /** Canonical creator wallet when set. */
  hostWallet?: RaffleBrowseHostFilter
  /** Canonical collection mint when set. */
  collectionMint?: RaffleBrowseCollectionFilter
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

/** Parse `?host=<wallet>` — invalid / empty → null. */
export function hostWalletFilterFromSearchParam(
  raw: string | null | undefined
): RaffleBrowseHostFilter {
  const t = (raw ?? '').trim()
  if (!t) return null
  return normalizeSolanaWalletAddress(t) ?? t
}

/** Parse `?collection=<mint>` — invalid / empty → null. */
export function collectionMintFilterFromSearchParam(
  raw: string | null | undefined
): RaffleBrowseCollectionFilter {
  const t = (raw ?? '').trim()
  if (!t) return null
  return normalizeSolanaWalletAddress(t) ?? t
}

export function isCryptoPrizeRaffle(raffle: Raffle): boolean {
  return raffle.prize_type === 'crypto' || raffle.prize_type == null
}

function searchableFields(raffle: Raffle): string[] {
  return [
    raffle.id,
    raffle.title,
    raffle.slug,
    raffle.description,
    raffle.nft_collection_name,
    raffle.nft_collection_mint,
    raffle.nft_token_id,
    raffle.nft_mint_address,
    raffle.prize_currency,
    raffle.promo_x_handle,
    raffle.creator_wallet,
    raffle.created_by,
    raffle.winner_wallet,
    // Host names (enriched) — optional match in `q`, not a substitute for `?host=`
    raffle.creator_display_name,
    raffle.creator_partner_display_name,
    raffle.creator_partner_table_label,
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim().toLowerCase())
}

/** Case-insensitive match on title, slug, id, mint, collection, prize ticker, wallets, host names, etc. */
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

/** Wallet-equality host filter (`creator_wallet || created_by`). */
export function raffleMatchesHostFilter(
  raffle: Raffle,
  hostWallet: RaffleBrowseHostFilter | undefined
): boolean {
  if (!hostWallet?.trim()) return true
  const creator = getRaffleHostWallet(raffle)
  if (!creator) return false
  return walletsEqualSolana(creator, hostWallet)
}

/** Collection-mint equality filter (`nft_collection_mint`). */
export function raffleMatchesCollectionFilter(
  raffle: Raffle,
  collectionMint: RaffleBrowseCollectionFilter | undefined
): boolean {
  if (!collectionMint?.trim()) return true
  const mint = raffle.nft_collection_mint?.trim()
  if (!mint) return false
  return walletsEqualSolana(mint, collectionMint)
}

export function raffleMatchesBrowseFilters(raffle: Raffle, filters: RaffleBrowseFilters): boolean {
  return (
    raffleMatchesBrowseSearch(raffle, filters.query) &&
    raffleMatchesTicketCurrencyFilter(raffle, filters.ticketCurrency) &&
    raffleMatchesPrizeFilter(raffle, filters.prize) &&
    raffleMatchesHostFilter(raffle, filters.hostWallet) &&
    raffleMatchesCollectionFilter(raffle, filters.collectionMint)
  )
}

export function filterRafflesBrowseList<T extends { raffle: Raffle }>(
  items: T[],
  filters: RaffleBrowseFilters
): T[] {
  if (
    !filters.query.trim() &&
    !filters.ticketCurrency &&
    !filters.prize &&
    !filters.hostWallet?.trim() &&
    !filters.collectionMint?.trim()
  ) {
    return items
  }
  return items.filter(({ raffle }) => raffleMatchesBrowseFilters(raffle, filters))
}

export function hasActiveBrowseFilters(filters: RaffleBrowseFilters): boolean {
  return Boolean(
    filters.query.trim() ||
      filters.ticketCurrency ||
      filters.prize ||
      filters.hostWallet?.trim() ||
      filters.collectionMint?.trim()
  )
}

/** Stamp profile/partner display names onto raffle copies for browse search + host UX. */
export function enrichRafflesWithCreatorDisplayNames<T extends { raffle: Raffle }>(
  items: T[],
  displayNamesByWallet: Record<string, string>
): T[] {
  if (items.length === 0) return items
  return items.map((item) => {
    const wallet = getRaffleHostWallet(item.raffle)
    const fromMap = wallet ? (displayNamesByWallet[wallet] || '').trim() : ''
    const nextName =
      fromMap ||
      (item.raffle.creator_display_name || '').trim() ||
      (item.raffle.creator_partner_display_name || '').trim() ||
      (item.raffle.creator_partner_table_label || '').trim() ||
      null
    if (!nextName || item.raffle.creator_display_name === nextName) return item
    return {
      ...item,
      raffle: { ...item.raffle, creator_display_name: nextName },
    }
  })
}
