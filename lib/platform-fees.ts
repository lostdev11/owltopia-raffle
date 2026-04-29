import { PublicKey } from '@solana/web3.js'
import { OWLTOPIA_COLLECTION_ADDRESS } from '@/lib/config/raffles'
import { OWLTOPIA_DAS_CACHE_TTL_MS } from '@/lib/dev-budget'
import { getOwltopiaSnapshotIfFresh, upsertOwltopiaHolderSnapshot } from '@/lib/db/owltopia-holder-snapshot'

const ownsOwltopiaCache = new Map<string, { value: boolean; expiresAt: number }>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Parse Retry-After from a 429 response (seconds or HTTP-date). Cap to avoid long stalls. */
function retryAfterMsFromResponse(res: Response): number {
  const h = res.headers.get('retry-after')
  if (!h) return 1_000
  const sec = parseInt(h, 10)
  if (!Number.isNaN(sec)) return Math.min(Math.max(sec, 1) * 1_000, 30_000)
  const date = Date.parse(h)
  if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 500), 30_000)
  return 1_000
}

/** True if DAS asset belongs to the Owltopia collection (grouping and/or on-chain metadata). */
function assetMatchesOwltopiaCollection(item: unknown, collectionAddress: string): boolean {
  if (!item || typeof item !== 'object') return false
  const o = item as Record<string, unknown>

  const grouping = o.grouping
  if (Array.isArray(grouping)) {
    const inCollection = grouping.some(
      (g: unknown) =>
        g &&
        typeof g === 'object' &&
        (g as { group_key?: string; group_value?: string }).group_key === 'collection' &&
        typeof (g as { group_value?: string }).group_value === 'string' &&
        (g as { group_value: string }).group_value === collectionAddress,
    )
    if (inCollection) return true
  }

  const topCol = o.collection
  if (topCol && typeof topCol === 'object') {
    const key = (topCol as { key?: string; address?: string }).key
    const addr = (topCol as { key?: string; address?: string }).address
    if (typeof key === 'string' && key === collectionAddress) return true
    if (typeof addr === 'string' && addr === collectionAddress) return true
  }

  const content = o.content
  if (content && typeof content === 'object') {
    const metadata = (content as { metadata?: { collection?: { key?: string; verified?: boolean } } }).metadata
    const key = metadata?.collection?.key
    if (typeof key === 'string' && key === collectionAddress) return true
  }

  return false
}

export type OwnsOwltopiaOptions = {
  /** When true, always verify against chain/DAS and do not use cache. Use for dashboard and when setting raffle fee. */
  skipCache?: boolean
  /**
   * Raffles list / card badges: after `searchAssets`, do not run the multi-batch `getAssetsByOwner` walk
   * (can be tens of RPC round-trips per wallet). Returns false when search is inconclusive; does not write cache.
   */
  listMode?: boolean
  /**
   * When true, allow a larger `getAssetsByOwner` walk (e.g. dashboard, ticket purchase, settlement).
   * List/badge mode keeps a smaller cap to save time and Helius quota.
   */
  deepWalletScan?: boolean
}

/**
 * Check whether a wallet currently owns an NFT from the Owltopia collection.
 *
 * - Runs server-side only.
 * - Uses Helius DAS searchAssets (owner + collection) when HELIUS_API_KEY + collection are set;
 *   if that returns no hit, scans the wallet via getAssetsByOwner with sortBy id + after (keyset), up to 50k–200k NFTs.
 * - Uses mainnet Helius for DAS even when SOLANA_RPC_URL is devnet (Owltopia NFTs are mainnet).
 * - Positive holder result requires Helius + OWLTOPIA_COLLECTION_ADDRESS; fungible OWL SPL balance is not used.
 * - Validates wallet address format; invalid addresses return false.
 * - Pass { skipCache: true } to force a fresh verification (e.g. dashboard load, creating a raffle).
 * - When skipCache is false, a Supabase row from the last 7 days may short-circuit Helius (see owltopia_holder_snapshots).
 */
export async function ownsOwltopia(
  walletAddress: string,
  options?: OwnsOwltopiaOptions
): Promise<boolean> {
  const normalized = walletAddress.trim()
  if (!normalized) return false

  const now = Date.now()
  if (!options?.skipCache) {
    const cached = ownsOwltopiaCache.get(normalized)
    if (cached && cached.expiresAt > now) {
      return cached.value
    }
  }

  // Validate wallet address format up front
  try {
    new PublicKey(normalized)
  } catch {
    return false
  }

  if (!options?.skipCache) {
    const fromSnapshot = await getOwltopiaSnapshotIfFresh(normalized)
    if (fromSnapshot !== null) {
      ownsOwltopiaCache.set(normalized, {
        value: fromSnapshot,
        expiresAt: now + OWLTOPIA_DAS_CACHE_TTL_MS,
      })
      return fromSnapshot
    }
  }

  const collectionAddress = OWLTOPIA_COLLECTION_ADDRESS?.trim()

  // 1) Helius DAS (mainnet): Owltopia NFTs live on mainnet — use mainnet Helius even if app RPC is devnet.
  const heliusApiKey = process.env.HELIUS_API_KEY?.trim()
  if (heliusApiKey && collectionAddress && collectionAddress !== 'REPLACE_WITH_COLLECTION') {
    const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusApiKey)}`

    const dasOptions = {
      showFungible: false,
      showGrandTotal: false,
      showInscription: false,
      showNativeBalance: false,
      showZeroBalance: false,
      showUnverifiedCollections: true,
    }

    try {
      // `tokenType: 'all'` can miss some compressed or standard NFTs in collection-filtered search; try explicit types too.
      const searchLimit = 15
      const tokenTypesListMode = ['all', 'compressedNft', 'regularNft'] as const
      const tokenTypesFull = ['all', 'nonFungible', 'compressedNft', 'regularNft'] as const
      const tokenTypes = options?.listMode ? tokenTypesListMode : tokenTypesFull

      let skipOwnerScan = false

      for (const tokenType of tokenTypes) {
        const searchBody = () =>
          JSON.stringify({
            jsonrpc: '2.0',
            id: `owltopia-ownership-search-${tokenType}`,
            method: 'searchAssets',
            params: {
              ownerAddress: normalized,
              tokenType,
              page: 1,
              limit: searchLimit,
              burnt: false,
              grouping: ['collection', collectionAddress],
              options: {
                showUnverifiedCollections: true,
              },
            },
          })

        let searchRes = await fetch(heliusUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: searchBody(),
        })
        if (searchRes.status === 429) {
          await sleep(retryAfterMsFromResponse(searchRes))
          searchRes = await fetch(heliusUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: searchBody(),
          })
        }

        if (!searchRes.ok) {
          if (searchRes.status === 429) {
            skipOwnerScan = true
            console.warn(
              'Helius searchAssets rate limited after retry; skipping DAS owner scan (holder check inconclusive → not holder)'
            )
            break
          }
          console.error('Helius searchAssets returned non-OK status', searchRes.status)
          continue
        }

        const searchJson: { error?: unknown; result?: { items?: unknown[] } } = await searchRes.json().catch(() => ({}))
        if (searchJson.error) continue

        const searchItems = searchJson.result?.items
        if (!Array.isArray(searchItems) || searchItems.length === 0) continue

        if (searchItems.some((item) => assetMatchesOwltopiaCollection(item, collectionAddress))) {
          ownsOwltopiaCache.set(normalized, {
            value: true,
            expiresAt: now + OWLTOPIA_DAS_CACHE_TTL_MS,
          })
          await upsertOwltopiaHolderSnapshot(normalized, true)
          return true
        }
      }

      // Keyset-style scan (sortBy id + after): walk the wallet in stable order (Helius keyset pagination).
      if (options?.listMode) {
        return false
      }

      const limit = 1000
      const maxBatches = options?.deepWalletScan ? 200 : 50
      let after: string | undefined
      let ownerScanAborted = false

      if (!skipOwnerScan)
        for (let batch = 0; batch < maxBatches; batch++) {
        const params: Record<string, unknown> = {
          ownerAddress: normalized,
          limit,
          sortBy: { sortBy: 'id', sortDirection: 'asc' },
          options: dasOptions,
        }
        if (after) params.after = after

        let res = await fetch(heliusUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: `owltopia-ownership-${batch}`,
            method: 'getAssetsByOwner',
            params,
          }),
        })

        if (res.status === 429) {
          await sleep(retryAfterMsFromResponse(res))
          res = await fetch(heliusUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: `owltopia-ownership-${batch}-retry`,
              method: 'getAssetsByOwner',
              params,
            }),
          })
        }

        if (!res.ok) {
          console.error('Helius getAssetsByOwner returned non-OK status', res.status)
          ownerScanAborted = true
          break
        }

        const json: { error?: unknown; result?: { items?: unknown[] } } = await res.json().catch(() => ({}))
        if (json.error) {
          ownerScanAborted = true
          break
        }

        const items = json.result?.items
        if (!Array.isArray(items) || items.length === 0) {
          ownsOwltopiaCache.set(normalized, {
            value: false,
            expiresAt: now + OWLTOPIA_DAS_CACHE_TTL_MS,
          })
          await upsertOwltopiaHolderSnapshot(normalized, false)
          return false
        }

        for (const item of items) {
          if (assetMatchesOwltopiaCollection(item, collectionAddress)) {
            ownsOwltopiaCache.set(normalized, {
              value: true,
              expiresAt: now + OWLTOPIA_DAS_CACHE_TTL_MS,
            })
            await upsertOwltopiaHolderSnapshot(normalized, true)
            return true
          }
        }

        if (items.length < limit) {
          ownsOwltopiaCache.set(normalized, {
            value: false,
            expiresAt: now + OWLTOPIA_DAS_CACHE_TTL_MS,
          })
          await upsertOwltopiaHolderSnapshot(normalized, false)
          return false
        }

        const last = items[items.length - 1] as { id?: string }
        if (typeof last?.id !== 'string' || !last.id) {
          ownerScanAborted = true
          break
        }
        after = last.id
      }

      if (!skipOwnerScan && !ownerScanAborted) {
        ownsOwltopiaCache.set(normalized, {
          value: false,
          expiresAt: now + OWLTOPIA_DAS_CACHE_TTL_MS,
        })
        await upsertOwltopiaHolderSnapshot(normalized, false)
        return false
      }
    } catch (err) {
      console.error('Helius Owltopia NFT ownership check failed:', err)
    }
  }

  // No NFT proved via DAS (missing Helius/key/collection, errors, rate limits, or wallet has no matching NFT).
  ownsOwltopiaCache.set(normalized, {
    value: false,
    expiresAt: Date.now() + OWLTOPIA_DAS_CACHE_TTL_MS,
  })
  return false
}

