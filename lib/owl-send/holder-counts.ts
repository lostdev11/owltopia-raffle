/**
 * Server-only: count Owltopia Gen1 + Gen2 NFTs for OwlSend holder fee discounts.
 * Uses live Helius DAS (no frozen airdrop floor — sold NFTs must drop the discount).
 * Caps counts at role ladder tops to save RPC credits.
 */

import { PublicKey } from '@solana/web3.js'
import {
  OWLTOPIA_COLLECTION_ADDRESS,
  resolveGen2HolderFeeCollectionAddress,
} from '@/lib/config/raffles'
import { OWLTOPIA_DAS_CACHE_TTL_MS } from '@/lib/dev-budget'
import { dasAssetBelongsToCollection } from '@/lib/helius/das-asset-collection'
import {
  OWL_SEND_GEN1_COUNT_CAP,
  OWL_SEND_GEN2_COUNT_CAP,
} from '@/lib/owl-send/holder-discount'

export type OwlSendHolderCounts = {
  gen1Count: number
  gen2Count: number
  /** False when Helius or collections are unavailable. */
  checkAvailable: boolean
}

type CacheEntry = { expiresAt: number; value: OwlSendHolderCounts }

const countsCache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<OwlSendHolderCounts>>()

function assetId(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null
  const id = (item as { id?: string }).id
  return typeof id === 'string' && id.length > 0 ? id : null
}

function gen1Collection(): string | null {
  const t = OWLTOPIA_COLLECTION_ADDRESS?.trim()
  if (!t || t === 'REPLACE_WITH_COLLECTION') return null
  return t
}

async function countViaSearchAssets(
  heliusUrl: string,
  owner: string,
  collectionAddress: string,
  maxCount: number,
  idPrefix: string
): Promise<number> {
  const tokenTypes = ['all', 'nonFungible', 'compressedNft', 'regularNft'] as const
  const seen = new Set<string>()
  let count = 0

  for (const tokenType of tokenTypes) {
    for (let page = 1; page <= 5 && count < maxCount; page++) {
      const res = await fetch(heliusUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `${idPrefix}-${tokenType}-${page}`,
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
        if (count >= maxCount) return count
      }

      if (items.length < 100) break
    }
    if (tokenType === 'all' && count > 0) break
  }

  return count
}

async function fetchLiveCounts(wallet: string): Promise<OwlSendHolderCounts> {
  const heliusApiKey = process.env.HELIUS_API_KEY?.trim()
  const gen1 = gen1Collection()
  const gen2 = resolveGen2HolderFeeCollectionAddress()?.trim() || null

  if (!heliusApiKey || (!gen1 && !gen2)) {
    return { gen1Count: 0, gen2Count: 0, checkAvailable: false }
  }

  const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusApiKey)}`

  try {
    const [gen1Count, gen2Count] = await Promise.all([
      gen1
        ? countViaSearchAssets(heliusUrl, wallet, gen1, OWL_SEND_GEN1_COUNT_CAP, 'owl-send-g1')
        : Promise.resolve(0),
      gen2
        ? countViaSearchAssets(heliusUrl, wallet, gen2, OWL_SEND_GEN2_COUNT_CAP, 'owl-send-g2')
        : Promise.resolve(0),
    ])
    return { gen1Count, gen2Count, checkAvailable: true }
  } catch (e) {
    console.warn('[owl-send/holder-counts] DAS count failed:', e)
    return { gen1Count: 0, gen2Count: 0, checkAvailable: false }
  }
}

/**
 * Live Gen1 + Gen2 hold counts for the connected wallet (OwlSend fee discount).
 * Cached briefly in-memory; pass skipCache for ledger verification.
 */
export async function getOwlSendHolderCounts(
  walletAddress: string,
  options?: { skipCache?: boolean }
): Promise<OwlSendHolderCounts> {
  const normalized = walletAddress.trim()
  if (!normalized) {
    return { gen1Count: 0, gen2Count: 0, checkAvailable: false }
  }

  try {
    // eslint-disable-next-line no-new
    new PublicKey(normalized)
  } catch {
    return { gen1Count: 0, gen2Count: 0, checkAvailable: false }
  }

  if (!options?.skipCache) {
    const cached = countsCache.get(normalized)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    const pending = inflight.get(normalized)
    if (pending) return pending
  }

  const work = fetchLiveCounts(normalized).then((value) => {
    if (!options?.skipCache) {
      countsCache.set(normalized, {
        expiresAt: Date.now() + OWLTOPIA_DAS_CACHE_TTL_MS,
        value,
      })
    }
    return value
  })

  if (!options?.skipCache) {
    inflight.set(normalized, work)
    work.finally(() => {
      if (inflight.get(normalized) === work) inflight.delete(normalized)
    })
  }

  return work
}
