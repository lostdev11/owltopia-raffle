/**
 * Collection used to recognize "Owl Nest" / Owltopia coin NFTs in wallet for nesting UI and policy.
 * Pool row `collection_key` overrides when set (admin-configured per perch), except the canonical
 * `owl-nest-365` perch also scans legacy + env addresses until production DB catches up.
 */

import {
  isGen1OwlStakingPoolSlug,
  isGen2OwlStakingPoolSlug,
  resolveGen1OwlCollectionAddress,
  resolveGen2OwlCollectionAddress,
} from '@/lib/nesting/gen1-staking-pools'

/** On-chain Owltopia coin collection (migration 106+). */
export const CANONICAL_OWL_NEST_365_COLLECTION_ADDRESS =
  'EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB'

/** Legacy grouped collection before migration 106 (Helius may still index some assets here). */
export const LEGACY_OWL_NEST_COLLECTION_ADDRESS =
  '9KLamQmRoZsB9ymyLAvSDGYvd6yku7oCaUyxCYXFfwsx'

export function resolveWalletOwlNestCollectionAddress(): string {
  return (
    process.env.NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS?.trim() ||
    process.env.OWLTOPIA_COLLECTION_ADDRESS?.trim() ||
    process.env.NEXT_PUBLIC_OWLTOPIA_COLLECTION_ADDRESS?.trim() ||
    CANONICAL_OWL_NEST_365_COLLECTION_ADDRESS
  )
}

/** Primary collection shown in UI / used for freeze when env + DB disagree. */
export function resolvePrimaryWalletOwlNestCollectionAddress(pool: {
  slug?: string | null
  collection_key?: string | null
}): string {
  const poolKey = pool.collection_key?.trim()
  if (isGen1OwlStakingPoolSlug(pool.slug)) {
    return poolKey || resolveGen1OwlCollectionAddress() || ''
  }
  if (isGen2OwlStakingPoolSlug(pool.slug)) {
    return poolKey || resolveGen2OwlCollectionAddress() || ''
  }
  const env = resolveWalletOwlNestCollectionAddress()
  if (pool.slug === 'owl-nest-365') {
    return env || CANONICAL_OWL_NEST_365_COLLECTION_ADDRESS
  }
  return poolKey || env
}

/** All collection pubkeys to query for wallet picker + ownership checks (deduped, stable order). */
export function resolveWalletOwlNestCollectionCandidates(pool: {
  slug?: string | null
  collection_key?: string | null
}): string[] {
  const out: string[] = []
  const add = (addr: string | null | undefined) => {
    const t = addr?.trim()
    if (t && !out.includes(t)) out.push(t)
  }

  const env = resolveWalletOwlNestCollectionAddress()
  const poolKey = pool.collection_key?.trim()

  if (isGen1OwlStakingPoolSlug(pool.slug)) {
    add(poolKey)
    add(resolveGen1OwlCollectionAddress())
    return out
  }

  if (isGen2OwlStakingPoolSlug(pool.slug)) {
    add(poolKey)
    add(resolveGen2OwlCollectionAddress())
    return out
  }

  if (pool.slug === 'owl-nest-365') {
    add(env)
    add(CANONICAL_OWL_NEST_365_COLLECTION_ADDRESS)
    add(poolKey)
    add(LEGACY_OWL_NEST_COLLECTION_ADDRESS)
    return out
  }

  // Any other perch (e.g. the Gen2 nests) is scoped strictly to its own configured collection so NFTs
  // from a different collection — like the Owltopia coins — are never eligible in it. Only fall back to
  // the shared env collection when the perch has no collection_key of its own.
  if (poolKey) {
    add(poolKey)
    return out
  }
  add(env)
  return out
}
