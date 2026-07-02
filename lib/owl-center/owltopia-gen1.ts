import { PublicKey } from '@solana/web3.js'

import { OWLTOPIA_COLLECTION_ADDRESS } from '@/lib/config/raffles'
import { getGen1SnapshotCount } from '@/lib/db/gen2-gen1-snapshot'
import { OWLTOPIA_DAS_CACHE_TTL_MS } from '@/lib/dev-budget'
import { dasAssetBelongsToCollection } from '@/lib/helius/das-asset-collection'

export type OwltopiaGen1Snapshot = {
  is_holder: boolean
  gen1_nft_count: number
  /** False when OWLTOPIA_COLLECTION_ADDRESS is unset or placeholder. */
  collection_configured: boolean
  /** False when Helius + collection are required but API key is missing. */
  holder_check_available: boolean
}

export type GetOwltopiaGen1SnapshotOptions = {
  /** When true, bypass the in-memory cache (admin / post-mint refresh). */
  skipCache?: boolean
  /**
   * When true, paginate the full wallet via getAssetsByOwner if searchAssets finds nothing.
   * Default false — saves Helius credits on mint-check traffic (most wallets are not Gen1 holders).
   */
  deepWalletScan?: boolean
}

const gen1SnapshotCache = new Map<string, { expiresAt: number; value: OwltopiaGen1Snapshot }>()
const gen1SnapshotInflight = new Map<string, Promise<OwltopiaGen1Snapshot>>()

function getCollectionAddress(): string | null {
  const collectionAddress = OWLTOPIA_COLLECTION_ADDRESS?.trim()
  if (!collectionAddress || collectionAddress === 'REPLACE_WITH_COLLECTION') return null
  return collectionAddress
}

function assetId(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null
  const id = (item as { id?: string }).id
  return typeof id === 'string' && id.length > 0 ? id : null
}

async function countViaSearchAssets(
  heliusUrl: string,
  owner: string,
  collectionAddress: string
): Promise<number> {
  const tokenTypes = ['all', 'nonFungible', 'compressedNft', 'regularNft'] as const
  const seen = new Set<string>()
  let count = 0

  for (const tokenType of tokenTypes) {
    for (let page = 1; page <= 5; page++) {
      const res = await fetch(heliusUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `owltopia-gen1-count-${tokenType}-${page}`,
          method: 'searchAssets',
          params: {
            ownerAddress: owner,
            tokenType,
            page,
            limit: 100,
            burnt: false,
            grouping: ['collection', collectionAddress],
            options: { showUnverifiedCollections: true },
          },
        }),
      })
      if (!res.ok) break

      const json: { result?: { items?: unknown[] } } = await res.json().catch(() => ({}))
      const items = json.result?.items
      if (!Array.isArray(items) || items.length === 0) break

      for (const item of items) {
        if (!dasAssetBelongsToCollection(item, collectionAddress)) continue
        const id = assetId(item)
        if (id && seen.has(id)) continue
        if (id) seen.add(id)
        count++
      }

      if (items.length < 100) break
    }
    // `all` usually covers the collection filter; skip extra tokenType passes when we already have hits.
    if (tokenType === 'all' && count > 0) break
  }

  return count
}

async function countViaOwnerScan(
  heliusUrl: string,
  owner: string,
  collectionAddress: string,
  maxCount = 100
): Promise<number> {
  const seen = new Set<string>()
  let count = 0
  let after: string | undefined
  const limit = 1000

  for (let batch = 0; batch < 50 && count < maxCount; batch++) {
    const params: Record<string, unknown> = {
      ownerAddress: owner,
      limit,
      sortBy: { sortBy: 'id', sortDirection: 'asc' },
      options: {
        showFungible: false,
        showUnverifiedCollections: true,
        showZeroBalance: false,
      },
    }
    if (after) params.after = after

    const res = await fetch(heliusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `owltopia-gen1-owner-${batch}`,
        method: 'getAssetsByOwner',
        params,
      }),
    })
    if (!res.ok) break

    const json: { error?: unknown; result?: { items?: unknown[] } } = await res.json().catch(() => ({}))
    if (json.error) break

    const items = json.result?.items
    if (!Array.isArray(items) || items.length === 0) break

    for (const item of items) {
      if (!dasAssetBelongsToCollection(item, collectionAddress)) continue
      const id = assetId(item)
      if (id && seen.has(id)) continue
      if (id) seen.add(id)
      count++
      if (count >= maxCount) return count
    }

    if (items.length < limit) break
    const last = items[items.length - 1] as { id?: string }
    if (typeof last?.id !== 'string' || !last.id) break
    after = last.id
  }

  return count
}

function cacheGen1Snapshot(wallet: string, value: OwltopiaGen1Snapshot): OwltopiaGen1Snapshot {
  gen1SnapshotCache.set(wallet, { expiresAt: Date.now() + OWLTOPIA_DAS_CACHE_TTL_MS, value })
  return value
}

async function resolveGen1SnapshotFromFrozen(wallet: string): Promise<OwltopiaGen1Snapshot | null> {
  const frozen = await getGen1SnapshotCount(wallet)
  if (frozen <= 0) return null
  return {
    is_holder: true,
    gen1_nft_count: frozen,
    collection_configured: true,
    holder_check_available: true,
  }
}

async function fetchOwltopiaGen1SnapshotLive(
  normalized: string,
  collectionAddress: string,
  options?: GetOwltopiaGen1SnapshotOptions
): Promise<OwltopiaGen1Snapshot> {
  const heliusApiKey = process.env.HELIUS_API_KEY?.trim()
  if (!heliusApiKey) {
    const fromFrozen = await resolveGen1SnapshotFromFrozen(normalized)
    if (fromFrozen) return fromFrozen
    return {
      is_holder: false,
      gen1_nft_count: 0,
      collection_configured: true,
      holder_check_available: false,
    }
  }

  const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusApiKey)}`

  try {
    let count = await countViaSearchAssets(heliusUrl, normalized, collectionAddress)
    if (count === 0 && options?.deepWalletScan === true) {
      count = await countViaOwnerScan(heliusUrl, normalized, collectionAddress)
    }

    if (count > 0) {
      return {
        is_holder: true,
        gen1_nft_count: count,
        collection_configured: true,
        holder_check_available: true,
      }
    }

    // searchAssets found nothing — trust the frozen airdrop snapshot before declaring non-holder.
    const fromFrozen = await resolveGen1SnapshotFromFrozen(normalized)
    if (fromFrozen) return fromFrozen

    return {
      is_holder: false,
      gen1_nft_count: 0,
      collection_configured: true,
      holder_check_available: true,
    }
  } catch (e) {
    console.warn('[owltopia-gen1] DAS count failed, using frozen snapshot if present:', e)
    const fromFrozen = await resolveGen1SnapshotFromFrozen(normalized)
    if (fromFrozen) return fromFrozen
    return {
      is_holder: false,
      gen1_nft_count: 0,
      collection_configured: true,
      holder_check_available: true,
    }
  }
}

/**
 * Count Owltopia Gen1 NFTs in a wallet (mainnet DAS).
 * Default path: quick searchAssets only + frozen snapshot floor (cheap for mint-check traffic).
 * Pass `{ deepWalletScan: true }` when you need the full wallet walk (admin / settlement).
 */
export async function getOwltopiaGen1Snapshot(
  walletAddress: string,
  options?: GetOwltopiaGen1SnapshotOptions
): Promise<OwltopiaGen1Snapshot> {
  const normalized = walletAddress.trim()
  const collectionAddress = getCollectionAddress()

  if (!collectionAddress || !normalized) {
    return {
      is_holder: false,
      gen1_nft_count: 0,
      collection_configured: false,
      holder_check_available: false,
    }
  }

  try {
    new PublicKey(normalized)
  } catch {
    return {
      is_holder: false,
      gen1_nft_count: 0,
      collection_configured: true,
      holder_check_available: true,
    }
  }

  if (!options?.skipCache) {
    const cached = gen1SnapshotCache.get(normalized)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    const inflight = gen1SnapshotInflight.get(normalized)
    if (inflight) return inflight
  }

  const work = fetchOwltopiaGen1SnapshotLive(normalized, collectionAddress, options).then((value) =>
    options?.skipCache ? value : cacheGen1Snapshot(normalized, value)
  )

  if (!options?.skipCache) {
    gen1SnapshotInflight.set(normalized, work)
    work.finally(() => {
      if (gen1SnapshotInflight.get(normalized) === work) gen1SnapshotInflight.delete(normalized)
    })
  }

  return work
}
