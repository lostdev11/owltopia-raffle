/**
 * Live Solana NFT collection floor from Tensor, Magic Eden, and Orbis.
 * Mint → collection via Helius DAS when possible; marketplaces are queried in parallel.
 */

import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import {
  extractDasAssetCollectionMint,
  extractDasAssetCollectionName,
} from '@/lib/helius/das-asset-collection'
import { pickNameFromHeliusAsset } from '@/lib/nft-helius-image'
import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import {
  getOrbisApiKey,
  lookupOrbisCollectionFloor,
  lookupOrbisNftUrl,
} from '@/lib/nft-marketplace-orbis'

const FETCH_TIMEOUT_MS = 8_000
const CACHE_TTL_MS = 60_000
const MAX_CACHE_ENTRIES = 200

/** Tensor Data API (https://dev.tensor.trade/reference/quickstart). Requires `x-tensor-api-key`. */
const TENSOR_DATA_API = 'https://api.mainnet.tensordev.io/api/v1'
const MAGIC_EDEN_V2 = 'https://api-mainnet.magiceden.dev/v2'

export const NFT_FLOOR_SOURCE_LABELS = {
  tensor: 'Tensor',
  magic_eden: 'Magic Eden',
  orbis: 'Orbis',
} as const

export type NftFloorSource = keyof typeof NFT_FLOOR_SOURCE_LABELS

export type NftFloorQuote = {
  source: NftFloorSource
  sourceLabel: string
  floorSol: number
  floorLamports: string
  listedCount: number | null
}

export type NftFloorLookupResult = {
  found: boolean
  mint: string | null
  collection: {
    address: string | null
    name: string | null
    magicEdenSymbol: string | null
    orbisPathname: string | null
  }
  nftName: string | null
  /** Lowest collection floor across successful marketplace sources (SOL). */
  floorSol: number | null
  floorLamports: string | null
  floorDisplay: string | null
  source: NftFloorSource | null
  sourceLabel: string | null
  sources: NftFloorQuote[]
  /** This mint's own list price when listed (SOL); not used as collection floor. */
  listingSol: number | null
  fetchedAt: string
}

type CacheEntry = { expiresAt: number; value: NftFloorLookupResult }

const cache = new Map<string, CacheEntry>()

function cacheGet(key: string): NftFloorLookupResult | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }
  return hit.value
}

function cacheSet(key: string, value: NftFloorLookupResult): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const first = cache.keys().next().value
    if (typeof first === 'string') cache.delete(first)
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value })
}

export function formatNftFloorSol(sol: number): string {
  if (!Number.isFinite(sol) || sol <= 0) return ''
  const decimals = sol >= 1 ? 4 : sol >= 0.01 ? 6 : 9
  const s = sol.toFixed(decimals)
  if (!s.includes('.')) return s
  return s.replace(/\.?0+$/, '')
}

function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / LAMPORTS_PER_SOL
}

function solToLamportsString(sol: number): string {
  return String(Math.round(sol * LAMPORTS_PER_SOL))
}

function parsePositiveLamports(raw: unknown): bigint | null {
  if (typeof raw === 'bigint' && raw > 0n) return raw
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return BigInt(Math.round(raw))
  }
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (/^\d+$/.test(t)) {
      try {
        const n = BigInt(t)
        return n > 0n ? n : null
      } catch {
        return null
      }
    }
    const asFloat = Number(t)
    if (Number.isFinite(asFloat) && asFloat > 0) return BigInt(Math.round(asFloat))
  }
  return null
}

/** Stats floors are lamports; a few Tensor oracle fields are SOL. */
function parseFloorToLamports(raw: unknown, unit: 'lamports' | 'sol'): bigint | null {
  if (unit === 'sol') {
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
    if (!Number.isFinite(n) || n <= 0) return null
    return BigInt(Math.round(n * LAMPORTS_PER_SOL))
  }
  return parsePositiveLamports(raw)
}

function listedCountFromUnknown(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<unknown | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!res.ok) return null
    return await res.json().catch(() => null)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function tensorApiKey(): string | null {
  return process.env.TENSOR_API_KEY?.trim() || null
}

function tensorHeaders(): HeadersInit {
  const headers: Record<string, string> = { accept: 'application/json' }
  const key = tensorApiKey()
  if (key) headers['x-tensor-api-key'] = key
  return headers
}

function magicEdenHeaders(): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const key = process.env.MAGIC_EDEN_API_KEY?.trim()
  if (key) {
    headers.Authorization = key.toLowerCase().startsWith('bearer ') ? key : `Bearer ${key}`
  }
  return headers
}

type DasNftContext = {
  collectionMint: string | null
  collectionName: string | null
  nftName: string | null
}

async function fetchDasNftContext(mint: string): Promise<DasNftContext> {
  const heliusUrl = getHeliusMainnetRpcUrl()
  if (!heliusUrl) {
    return { collectionMint: null, collectionName: null, nftName: null }
  }
  const json = await fetchJson(heliusUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'nft-floor-get-asset',
      method: 'getAsset',
      params: {
        id: mint,
        displayOptions: { showCollectionMetadata: true, showUnverifiedCollections: true },
      },
    }),
  })
  const result =
    json && typeof json === 'object' ? (json as { result?: unknown }).result : null
  if (!result) return { collectionMint: null, collectionName: null, nftName: null }
  return {
    collectionMint: extractDasAssetCollectionMint(result),
    collectionName: extractDasAssetCollectionName(result),
    nftName: pickNameFromHeliusAsset(result),
  }
}

/** Tensor Hub recipe uses `stats.buyNowPrice` in lamports. */
function pickTensorFloorLamports(row: Record<string, unknown>): bigint | null {
  const stats = row.stats && typeof row.stats === 'object' ? (row.stats as Record<string, unknown>) : null
  const statsV2 = row.statsV2 && typeof row.statsV2 === 'object' ? (row.statsV2 as Record<string, unknown>) : null
  const candidates: unknown[] = [
    stats?.buyNowPrice,
    statsV2?.buyNowPrice,
    stats?.floorPrice,
    statsV2?.floorPrice,
    row.buyNowPrice,
    row.floorPrice,
  ]
  for (const c of candidates) {
    const lamports = parseFloorToLamports(c, 'lamports')
    if (lamports) return lamports
  }
  return null
}

function tensorRowsFromPayload(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
  }
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>
    for (const key of ['collections', 'mints', 'listings', 'activeListings', 'data']) {
      const v = o[key]
      if (Array.isArray(v)) {
        return v.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
      }
    }
    return [o]
  }
  return []
}

function tensorQuoteFromCollectionRow(row: Record<string, unknown>): NftFloorQuote | null {
  const lamports = pickTensorFloorLamports(row)
  if (!lamports) return null
  const sol = lamportsToSol(lamports)
  if (!Number.isFinite(sol) || sol <= 0) return null
  const stats = row.stats && typeof row.stats === 'object' ? (row.stats as Record<string, unknown>) : null
  const statsV2 = row.statsV2 && typeof row.statsV2 === 'object' ? (row.statsV2 as Record<string, unknown>) : null
  return {
    source: 'tensor',
    sourceLabel: NFT_FLOOR_SOURCE_LABELS.tensor,
    floorSol: sol,
    floorLamports: lamports.toString(),
    listedCount: listedCountFromUnknown(
      stats?.numListed ?? statsV2?.numListed ?? row.listedCount ?? row.numListed,
    ),
  }
}

function tensorCollIdFromRow(row: Record<string, unknown>): string | null {
  const id = row.collId ?? row.id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

async function fetchTensorCollectionByFilter(filter: string): Promise<Record<string, unknown> | null> {
  const payload = await fetchJson(
    `${TENSOR_DATA_API}/collections/find_collection?filter=${encodeURIComponent(filter)}`,
    { headers: tensorHeaders() },
  )
  const rows = tensorRowsFromPayload(payload)
  return rows[0] ?? null
}

async function fetchTensorCollIdForMint(mint: string): Promise<string | null> {
  const payload = await fetchJson(
    `${TENSOR_DATA_API}/collections/mints?mints=${encodeURIComponent(mint)}`,
    { headers: tensorHeaders() },
  )
  const rows = tensorRowsFromPayload(payload)
  const first = rows[0]
  if (!first) return null
  return tensorCollIdFromRow(first)
}

async function fetchTensorListingsFloor(collId: string): Promise<NftFloorQuote | null> {
  const params = new URLSearchParams({
    collId,
    sortBy: 'ListingPriceAsc',
    limit: '1',
  })
  const payload = await fetchJson(`${TENSOR_DATA_API}/mint/active_listings?${params.toString()}`, {
    headers: tensorHeaders(),
  })
  const rows = tensorRowsFromPayload(payload)
  const first = rows[0]
  if (!first) return null
  const listing =
    first.listing && typeof first.listing === 'object' ? (first.listing as Record<string, unknown>) : first
  const lamports = parseFloorToLamports(
    listing.price ?? listing.listPrice ?? listing.buyNowPrice ?? first.price,
    'lamports',
  )
  if (!lamports) return null
  const sol = lamportsToSol(lamports)
  if (!Number.isFinite(sol) || sol <= 0) return null
  return {
    source: 'tensor',
    sourceLabel: NFT_FLOOR_SOURCE_LABELS.tensor,
    floorSol: sol,
    floorLamports: lamports.toString(),
    listedCount: null,
  }
}

/**
 * Tensor Data API floor (https://dev.tensor.trade/reference/quickstart).
 * Auth: `x-tensor-api-key`. Floor is `stats.buyNowPrice` in lamports.
 */
async function fetchTensorFloor(params: {
  collectionMint: string | null
  mint: string | null
}): Promise<NftFloorQuote | null> {
  if (!tensorApiKey()) return null
  const collectionMint = params.collectionMint?.trim() || null
  const mint = params.mint?.trim() || null
  if (!collectionMint && !mint) return null

  const filters: string[] = []
  if (collectionMint) filters.push(collectionMint)
  if (mint) {
    const collId = await fetchTensorCollIdForMint(mint)
    if (collId && !filters.includes(collId)) filters.push(collId)
  }

  for (const filter of filters) {
    const row = await fetchTensorCollectionByFilter(filter)
    if (!row) continue
    const quote = tensorQuoteFromCollectionRow(row)
    if (quote) return quote
    const collId = tensorCollIdFromRow(row)
    if (collId) {
      const listed = await fetchTensorListingsFloor(collId)
      if (listed) return listed
    }
  }

  if (collectionMint) {
    const qs = new URLSearchParams({
      sortBy: 'statsV2.numListed:desc',
      limit: '1',
      vocs: collectionMint,
    })
    const payload = await fetchJson(`${TENSOR_DATA_API}/collections?${qs.toString()}`, {
      headers: tensorHeaders(),
    })
    for (const row of tensorRowsFromPayload(payload)) {
      const quote = tensorQuoteFromCollectionRow(row)
      if (quote) return quote
    }
  }

  return null
}

type MagicEdenTokenInfo = {
  symbol: string | null
  listingSol: number | null
  collectionName: string | null
  nftName: string | null
}

function parseMeListingSol(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  // Token `price` is SOL; if a lamports-scale number slips through, convert.
  if (n >= 1_000_000) return n / LAMPORTS_PER_SOL
  return n
}

async function fetchMagicEdenToken(mint: string): Promise<MagicEdenTokenInfo> {
  const payload = await fetchJson(`${MAGIC_EDEN_V2}/tokens/${encodeURIComponent(mint)}`, {
    headers: magicEdenHeaders(),
  })
  if (!payload || typeof payload !== 'object') {
    return { symbol: null, listingSol: null, collectionName: null, nftName: null }
  }
  const o = payload as Record<string, unknown>
  const symbol =
    (typeof o.collection === 'string' && o.collection.trim()) ||
    (typeof o.collectionSymbol === 'string' && o.collectionSymbol.trim()) ||
    null
  const collectionName =
    typeof o.collectionName === 'string' && o.collectionName.trim() ? o.collectionName.trim() : null
  const nftName = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : null
  return {
    symbol,
    listingSol: parseMeListingSol(o.price),
    collectionName,
    nftName,
  }
}

async function fetchMagicEdenStats(symbol: string): Promise<NftFloorQuote | null> {
  const payload = await fetchJson(
    `${MAGIC_EDEN_V2}/collections/${encodeURIComponent(symbol)}/stats`,
    { headers: magicEdenHeaders() },
  )
  if (!payload || typeof payload !== 'object') return null
  const o = payload as Record<string, unknown>
  const lamports = parseFloorToLamports(o.floorPrice, 'lamports')
  if (!lamports) return null
  const sol = lamportsToSol(lamports)
  if (!Number.isFinite(sol) || sol <= 0) return null
  return {
    source: 'magic_eden',
    sourceLabel: NFT_FLOOR_SOURCE_LABELS.magic_eden,
    floorSol: sol,
    floorLamports: lamports.toString(),
    listedCount: listedCountFromUnknown(o.listedCount),
  }
}

function pickBestQuote(quotes: NftFloorQuote[]): NftFloorQuote | null {
  let best: NftFloorQuote | null = null
  for (const q of quotes) {
    if (!best || q.floorSol < best.floorSol) best = q
  }
  return best
}

function emptyResult(partial: Partial<NftFloorLookupResult> & { mint: string | null }): NftFloorLookupResult {
  return {
    found: false,
    collection: { address: null, name: null, magicEdenSymbol: null, orbisPathname: null },
    nftName: null,
    floorSol: null,
    floorLamports: null,
    floorDisplay: null,
    source: null,
    sourceLabel: null,
    sources: [],
    listingSol: null,
    fetchedAt: new Date().toISOString(),
    ...partial,
  }
}

export async function lookupNftFloorPrice(params: {
  mint?: string | null
  collection?: string | null
}): Promise<NftFloorLookupResult> {
  const mint = params.mint ? normalizeSolanaWalletAddress(params.mint) : null
  const collectionHint = params.collection ? normalizeSolanaWalletAddress(params.collection) : null

  if (!mint && !collectionHint) {
    return emptyResult({ mint: null })
  }

  const cacheKey = `${mint ?? ''}:${collectionHint ?? ''}`
  const cached = cacheGet(cacheKey)
  if (cached) return cached

  const [das, meToken, orbisMint] = await Promise.all([
    mint
      ? fetchDasNftContext(mint)
      : Promise.resolve({
          collectionMint: collectionHint,
          collectionName: null as string | null,
          nftName: null as string | null,
        }),
    mint ? fetchMagicEdenToken(mint) : Promise.resolve(null),
    mint && getOrbisApiKey() ? lookupOrbisNftUrl(mint) : Promise.resolve(null),
  ])

  const collectionMint = das.collectionMint ?? collectionHint
  const orbisPathname = orbisMint?.found ? orbisMint.collectionPathname : null

  const meSymbols = new Set<string>()
  if (meToken?.symbol) meSymbols.add(meToken.symbol)
  // ME stats is keyed by collection symbol; the on-chain mint only works for some collections (e.g. ME marketplace URLs).
  if (!meToken?.symbol && collectionMint) meSymbols.add(collectionMint)

  const [tensorQuote, orbisLookup, ...meQuotes] = await Promise.all([
    fetchTensorFloor({ collectionMint, mint }),
    lookupOrbisCollectionFloor({
      collectionAddress: collectionMint,
      pathname: orbisPathname,
    }),
    ...[...meSymbols].map((symbol) => fetchMagicEdenStats(symbol)),
  ])

  const quotes: NftFloorQuote[] = []
  if (tensorQuote) quotes.push(tensorQuote)
  if (orbisLookup) {
    quotes.push({
      source: 'orbis',
      sourceLabel: NFT_FLOOR_SOURCE_LABELS.orbis,
      floorSol: orbisLookup.floorSol,
      floorLamports: solToLamportsString(orbisLookup.floorSol),
      listedCount: orbisLookup.listedCount,
    })
  }
  const seenMe = new Set<string>()
  for (const q of meQuotes) {
    if (!q) continue
    const k = q.floorLamports
    if (seenMe.has(k)) continue
    seenMe.add(k)
    quotes.push(q)
  }

  const best = pickBestQuote(quotes)
  const result: NftFloorLookupResult = {
    found: best != null,
    mint,
    collection: {
      address: collectionMint,
      name: das.collectionName ?? meToken?.collectionName ?? orbisLookup?.collectionName ?? null,
      magicEdenSymbol: meToken?.symbol ?? null,
      orbisPathname: orbisLookup?.pathname ?? orbisPathname,
    },
    nftName: das.nftName ?? meToken?.nftName ?? null,
    floorSol: best?.floorSol ?? null,
    floorLamports: best?.floorLamports ?? null,
    floorDisplay: best ? formatNftFloorSol(best.floorSol) : null,
    source: best?.source ?? null,
    sourceLabel: best?.sourceLabel ?? null,
    sources: quotes.sort((a, b) => a.floorSol - b.floorSol),
    listingSol: meToken?.listingSol ?? null,
    fetchedAt: new Date().toISOString(),
  }

  cacheSet(cacheKey, result)
  return result
}
