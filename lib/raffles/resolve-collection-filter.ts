import type { Raffle } from '@/lib/types'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type CollectionCandidate = {
  mint: string
  label: string
}

const COLLECTION_SUGGESTION_LIMIT = 8

export function truncateMintLabel(mint: string): string {
  const t = mint.trim()
  if (t.length <= 12) return t
  return `${t.slice(0, 4)}…${t.slice(-4)}`
}

export function collectionLabelForRaffle(raffle: Raffle): string {
  const name = (raffle.nft_collection_name || '').trim()
  if (name) return name
  const mint = raffle.nft_collection_mint?.trim() || ''
  return mint ? truncateMintLabel(mint) : 'Unknown collection'
}

/** Unique collections from a raffle list (mint is the identity key). */
export function collectCollectionCandidates(
  raffles: Iterable<Raffle>,
  limit = 500
): CollectionCandidate[] {
  const byMint = new Map<string, CollectionCandidate>()
  for (const raffle of raffles) {
    const mint = raffle.nft_collection_mint?.trim()
    if (!mint) continue
    const key = normalizeSolanaWalletAddress(mint) ?? mint
    if (byMint.has(key)) continue
    byMint.set(key, { mint: key, label: collectionLabelForRaffle(raffle) })
    if (byMint.size >= limit) break
  }
  return [...byMint.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  )
}

function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase()
}

export function collectionCandidateMatchesQuery(
  candidate: CollectionCandidate,
  rawQuery: string
): boolean {
  const q = normalizeQuery(rawQuery)
  if (!q) return false
  if (candidate.label.toLowerCase().includes(q)) return true
  if (candidate.mint.toLowerCase().includes(q)) return true
  return false
}

export function suggestCollections(
  rawQuery: string,
  candidates: CollectionCandidate[]
): CollectionCandidate[] {
  const q = rawQuery.trim()
  if (!q) return []
  return candidates
    .filter((c) => collectionCandidateMatchesQuery(c, q))
    .slice(0, COLLECTION_SUGGESTION_LIMIT)
}

export function resolveCollectionCandidates(
  rawQuery: string,
  candidates: CollectionCandidate[]
): CollectionCandidate[] {
  const q = rawQuery.trim()
  if (!q) return []
  const asMint = normalizeSolanaWalletAddress(q)
  if (asMint) {
    const exact = candidates.find((c) => (normalizeSolanaWalletAddress(c.mint) ?? c.mint) === asMint)
    return exact ? [exact] : [{ mint: asMint, label: truncateMintLabel(asMint) }]
  }
  return candidates.filter((c) => collectionCandidateMatchesQuery(c, q))
}

export type CollectionResolveOutcome =
  | { status: 'empty' }
  | { status: 'none' }
  | { status: 'one'; collection: CollectionCandidate }
  | { status: 'many'; collections: CollectionCandidate[] }

export function classifyCollectionResolve(
  rawQuery: string,
  candidates: CollectionCandidate[]
): CollectionResolveOutcome {
  const q = rawQuery.trim()
  if (!q) return { status: 'empty' }
  const hits = resolveCollectionCandidates(q, candidates)
  if (hits.length === 0) return { status: 'none' }
  if (hits.length === 1 && hits[0]) return { status: 'one', collection: hits[0] }
  return { status: 'many', collections: hits.slice(0, 12) }
}
