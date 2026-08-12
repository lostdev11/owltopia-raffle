import type { Raffle } from '@/lib/types'
import { getRaffleHostWallet } from '@/lib/raffles/host-wallet-copy'
import {
  normalizeSolanaWalletAddress,
  walletsEqualSolana,
} from '@/lib/solana/normalize-wallet'

/** One unique host for typeahead / ambiguous-name picker. */
export type HostCandidate = {
  wallet: string
  /** Prefer profile/partner display name; fall back to truncated wallet. */
  label: string
}

const HOST_SUGGESTION_LIMIT = 8

export function truncateWalletLabel(wallet: string): string {
  const t = wallet.trim()
  if (t.length <= 12) return t
  return `${t.slice(0, 4)}…${t.slice(-4)}`
}

/** Best public label for a creator wallet (profile → partner → truncated wallet). */
export function hostLabelForRaffle(raffle: Raffle): string {
  const wallet = getRaffleHostWallet(raffle)
  const fromProfile = (raffle.creator_display_name || '').trim()
  if (fromProfile) return fromProfile
  const fromPartner =
    (raffle.creator_partner_display_name || '').trim() ||
    (raffle.creator_partner_table_label || '').trim()
  if (fromPartner) return fromPartner
  return wallet ? truncateWalletLabel(wallet) : 'Unknown host'
}

/**
 * Unique hosts from a raffle list (wallet is the identity key).
 * Display names are UX only — filtering always uses wallet.
 */
export function collectHostCandidates(
  raffles: Iterable<Raffle>,
  limit = 500
): HostCandidate[] {
  const byWallet = new Map<string, HostCandidate>()
  for (const raffle of raffles) {
    const wallet = getRaffleHostWallet(raffle)
    if (!wallet || byWallet.has(wallet)) continue
    byWallet.set(wallet, { wallet, label: hostLabelForRaffle(raffle) })
    if (byWallet.size >= limit) break
  }
  return [...byWallet.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  )
}

function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Case-insensitive label / wallet substring match. */
export function hostCandidateMatchesQuery(candidate: HostCandidate, rawQuery: string): boolean {
  const q = normalizeQuery(rawQuery)
  if (!q) return false
  if (candidate.label.toLowerCase().includes(q)) return true
  if (candidate.wallet.toLowerCase().includes(q)) return true
  return false
}

/**
 * Resolve a typed host query to candidate wallets.
 * - Exact wallet (valid pubkey) → that host when present, else empty.
 * - Otherwise label/wallet substring matches (may be 0 / 1 / N — caller shows picker when N > 1).
 */
export function resolveHostCandidates(
  rawQuery: string,
  candidates: HostCandidate[]
): HostCandidate[] {
  const q = rawQuery.trim()
  if (!q) return []

  const asWallet = normalizeSolanaWalletAddress(q)
  if (asWallet) {
    const exact = candidates.find((c) => walletsEqualSolana(c.wallet, asWallet))
    return exact ? [exact] : []
  }

  const qLower = q.toLowerCase()
  const exactLabel = candidates.filter((c) => c.label.trim().toLowerCase() === qLower)
  if (exactLabel.length > 0) return exactLabel

  return candidates.filter((c) => hostCandidateMatchesQuery(c, q))
}

/** Debounced typeahead suggestions (capped). Empty query → empty list. */
export function suggestHosts(
  rawQuery: string,
  candidates: HostCandidate[],
  limit = HOST_SUGGESTION_LIMIT
): HostCandidate[] {
  const q = normalizeQuery(rawQuery)
  if (!q) return []
  const matches = candidates.filter((c) => hostCandidateMatchesQuery(c, q))
  return matches.slice(0, Math.max(1, limit))
}

export type HostResolveOutcome =
  | { status: 'empty' }
  | { status: 'none' }
  | { status: 'one'; host: HostCandidate }
  | { status: 'many'; hosts: HostCandidate[] }

export function classifyHostResolve(
  rawQuery: string,
  candidates: HostCandidate[]
): HostResolveOutcome {
  if (!rawQuery.trim()) return { status: 'empty' }
  const matches = resolveHostCandidates(rawQuery, candidates)
  if (matches.length === 0) return { status: 'none' }
  if (matches.length === 1) return { status: 'one', host: matches[0]! }
  return { status: 'many', hosts: matches }
}
