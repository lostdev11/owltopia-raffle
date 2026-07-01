/**
 * Resolve NFT artwork URL via Helius DAS getAsset (server-side).
 */
import {
  arweaveTxIdFromHttps,
  normalizeOwlCenterArweaveGatewayUri,
  walletSafeArweaveGatewayUri,
} from '@/lib/owl-center/arweave-gateway-uri'
import { getHeliusMainnetRpcUrl, getHeliusRpcUrl } from '@/lib/helius-rpc-url'
import { irysGatewayMirrorHttpsUrls, isIrysGatewayHttpsUrl } from '@/lib/nft-media-uri'

export function pickImageFromHeliusAsset(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  const content = r.content as Record<string, unknown> | undefined
  if (!content) return null

  const pickFromPropertiesFiles = (metadata: Record<string, unknown> | undefined): string | null => {
    const props = metadata?.properties as Record<string, unknown> | undefined
    const files = props?.files as Array<{ uri?: string; type?: string }> | undefined
    if (!Array.isArray(files)) return null
    // Prefer explicit image mime; else first usable uri (Metaplex metadata pattern).
    for (const entry of files) {
      const t = (entry?.type ?? '').toLowerCase()
      const u = entry?.uri?.trim()
      if (!u) continue
      if (t.startsWith('image/')) return u
    }
    const firstUri = files.find((f) => typeof f?.uri === 'string' && f.uri.trim())?.uri?.trim()
    return firstUri ?? null
  }

  const metadata = content.metadata as Record<string, unknown> | undefined

  const metaImg = metadata?.image
  const metaImgStr =
    typeof metaImg === 'string'
      ? metaImg.trim()
      : metaImg && typeof metaImg === 'object' && metaImg !== null
        ? (metaImg as { uri?: string }).uri?.trim() ?? ''
        : ''
  // Inline arweave.net image beats Helius CDN wrappers around dead gateway.irys.xyz paths.
  if (metaImgStr && /arweave\.net\//i.test(metaImgStr)) return metaImgStr

  const files = content.files as Array<{ uri?: string; cdn_uri?: string }> | undefined
  const first = files?.[0]
  const cdn = first?.cdn_uri?.trim()
  const direct = first?.uri?.trim()
  if (direct && /arweave\.net\//i.test(direct)) return direct
  // Prefer Helius CDN over raw gateway.irys.xyz when no canonical arweave.net uri is present.
  if (cdn) return cdn
  if (direct) return direct

  const fromPropFiles = pickFromPropertiesFiles(metadata)
  if (fromPropFiles) return fromPropFiles

  if (metaImgStr) return metaImgStr

  const links = content.links as Record<string, unknown> | undefined
  const linkImg = links?.image
  if (typeof linkImg === 'string' && linkImg.trim()) return linkImg.trim()

  return null
}

export function pickNameFromHeliusAsset(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const content = (result as Record<string, unknown>).content as Record<string, unknown> | undefined
  if (!content) return null
  const metadata = content.metadata as Record<string, unknown> | undefined
  const n = metadata?.name
  return typeof n === 'string' && n.trim() ? n.trim() : null
}

function extractJsonUriFromDasAsset(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const content = (result as Record<string, unknown>).content as Record<string, unknown> | undefined
  if (!content) return null
  const ju = content.json_uri ?? content.jsonUri
  return typeof ju === 'string' && ju.trim() ? ju.trim() : null
}

/** Try multiple Arweave/Irys gateways when fetching off-chain metadata JSON. */
function metadataJsonFetchCandidates(uri: string): string[] {
  const trimmed = uri.trim()
  if (!trimmed) return []
  const mirrors = new Set<string>([trimmed])
  if (isIrysGatewayHttpsUrl(trimmed)) {
    for (const m of irysGatewayMirrorHttpsUrls(trimmed)) mirrors.add(m)
  }
  const id = arweaveTxIdFromHttps(trimmed)
  if (id) {
    mirrors.add(walletSafeArweaveGatewayUri(trimmed))
    mirrors.add(normalizeOwlCenterArweaveGatewayUri(trimmed))
  }
  return [...mirrors]
}

const METADATA_JSON_TIMEOUT_MS = 3_500

/** Resolve `image.png` / `./x` against the metadata JSON URL (common on Arweave / IPFS). */
function normalizeMediaUri(uri: string | null, baseJsonUri: string | null): string | null {
  if (!uri?.trim()) return null
  const u = uri.trim()
  if (/^(https?:|ipfs:|ar:)/i.test(u)) return u
  if (!baseJsonUri?.trim()) return u
  try {
    return new URL(u, baseJsonUri.trim()).href
  } catch {
    return u
  }
}

async function fetchMintFieldsFromMetadataJson(
  jsonUri: string
): Promise<{ image: string | null; name: string | null; baseUri: string | null }> {
  for (const url of metadataJsonFetchCandidates(jsonUri)) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), METADATA_JSON_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json, text/plain;q=0.9,*/*;q=0.8' },
      })
      if (!res.ok) continue
      const data: unknown = await res.json().catch(() => null)
      if (!data || typeof data !== 'object') continue
      const rec = data as { image?: unknown; name?: unknown }
      const img = rec.image
      const image = typeof img === 'string' && img.trim() ? img.trim() : null
      const nm = rec.name
      const name = typeof nm === 'string' && nm.trim() ? nm.trim() : null
      if (image || name) return { image, name, baseUri: url }
    } catch {
      /* try next gateway mirror */
    } finally {
      clearTimeout(timer)
    }
  }
  return { image: null, name: null, baseUri: null }
}

/**
 * Inline DAS fields first, then optional single `json_uri` fetch (Metaplex Core / sparse indexer rows).
 */
export async function resolveMintMetaFromDasAssetPayload(
  result: unknown
): Promise<{ image: string | null; name: string | null }> {
  const jsonUri = extractJsonUriFromDasAsset(result)
  let image = normalizeMediaUri(pickImageFromHeliusAsset(result), jsonUri)
  let name = pickNameFromHeliusAsset(result)

  if (image && name) return { image, name }

  if (jsonUri) {
    const j = await fetchMintFieldsFromMetadataJson(jsonUri)
    if (!image && j.image) image = normalizeMediaUri(j.image, j.baseUri ?? jsonUri)
    if (!name && j.name) name = j.name
  }

  return { image, name }
}

/**
 * Inline DAS fields first, then optional `json_uri` fetch (Metaplex Core / sparse indexer rows).
 */
export async function resolveImageUriFromDasAssetPayload(result: unknown): Promise<string | null> {
  const { image } = await resolveMintMetaFromDasAssetPayload(result)
  return image
}

const FETCH_TIMEOUT_MS = 4_500

/** Short TTL cache (same Node process / warm serverless) to avoid repeat DAS getAsset for Discord embeds, etc. */
const IMAGE_URI_CACHE_MAX = 400
const IMAGE_URI_CACHE_TTL_MS = 86_400_000
const mintMetaCache = new Map<string, { expiresAt: number; image: string | null; name: string | null }>()

function cacheMintMeta(
  assetId: string,
  meta: { image: string | null; name: string | null }
): void {
  const now = Date.now()
  while (mintMetaCache.size >= IMAGE_URI_CACHE_MAX) {
    const first = mintMetaCache.keys().next().value as string | undefined
    if (first) mintMetaCache.delete(first)
    else break
  }
  const miss = meta.image === null && meta.name === null
  const ttl = miss ? 120_000 : IMAGE_URI_CACHE_TTL_MS
  mintMetaCache.set(assetId, { expiresAt: now + ttl, ...meta })
}

export type FetchNftImageFromHeliusOptions = {
  /** Use mainnet Helius DAS (canonical for prod Owl Nest / TM assets when app RPC is devnet). */
  preferMainnet?: boolean
}

export type NftMintMetaFromHelius = {
  /** Raw image URI (may be ipfs://, https, ar://…). */
  image: string | null
  name: string | null
}

/**
 * Returns display metadata for a mint via Helius DAS getAsset (+ optional json_uri).
 */
export async function fetchNftMintMetaFromHelius(
  assetId: string,
  options?: FetchNftImageFromHeliusOptions
): Promise<NftMintMetaFromHelius | null> {
  const id = assetId.trim()
  if (!id) return null

  const preferMainnet = options?.preferMainnet === true
  const cacheLookupKey = preferMainnet ? `m:${id}` : id

  const heliusUrl = preferMainnet ? getHeliusMainnetRpcUrl() : getHeliusRpcUrl()
  if (!heliusUrl) return null

  const cached = mintMetaCache.get(cacheLookupKey)
  if (cached && cached.expiresAt > Date.now()) {
    return { image: cached.image, name: cached.name }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(heliusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'nft-image-resolve',
        method: 'getAsset',
        params: { id },
      }),
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) return null
    const json: { result?: unknown; error?: unknown } = await res.json().catch(() => ({}))
    if (json.error) return null
    const meta = await resolveMintMetaFromDasAssetPayload(json.result)
    cacheMintMeta(cacheLookupKey, meta)
    return meta
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Returns a raw image URI from metadata (may be ipfs://, https, ar://…).
 */
export async function fetchNftImageUriFromHelius(
  assetId: string,
  options?: FetchNftImageFromHeliusOptions
): Promise<string | null> {
  const meta = await fetchNftMintMetaFromHelius(assetId, options)
  return meta?.image ?? null
}

const BATCH_CHUNK_SIZE = 20
const BATCH_JSON_RESOLVE_CONCURRENCY = 4

function mintMetaCacheKey(assetId: string, preferMainnet: boolean): string {
  return preferMainnet ? `m:${assetId}` : assetId
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (!items.length) return []
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const idx = next++
      results[idx] = await fn(items[idx]!)
    }
  }
  const workers = Math.min(Math.max(1, concurrency), items.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}

async function heliusGetAssetBatch(
  heliusUrl: string,
  ids: string[]
): Promise<Map<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(heliusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'nft-image-batch',
        method: 'getAssetBatch',
        params: { ids },
      }),
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) return new Map()
    const json: { result?: unknown[]; error?: unknown } = await res.json().catch(() => ({}))
    if (json.error || !Array.isArray(json.result)) return new Map()
    const out = new Map<string, unknown>()
    for (const row of json.result) {
      if (!row || typeof row !== 'object') continue
      const id = (row as { id?: string }).id?.trim()
      if (id) out.set(id, row)
    }
    return out
  } catch {
    return new Map()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolve metadata for many mints via Helius DAS getAssetBatch (chunked, cached).
 */
export async function fetchNftMintMetaBatchFromHelius(
  assetIds: string[],
  options?: FetchNftImageFromHeliusOptions
): Promise<Map<string, NftMintMetaFromHelius>> {
  const preferMainnet = options?.preferMainnet === true
  const heliusUrl = preferMainnet ? getHeliusMainnetRpcUrl() : getHeliusRpcUrl()
  const out = new Map<string, NftMintMetaFromHelius>()
  if (!heliusUrl) return out

  const unique = [...new Set(assetIds.map((id) => id.trim()).filter(Boolean))]
  const missing: string[] = []

  for (const id of unique) {
    const key = mintMetaCacheKey(id, preferMainnet)
    const cached = mintMetaCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      out.set(id, { image: cached.image, name: cached.name })
    } else {
      missing.push(id)
    }
  }

  for (let i = 0; i < missing.length; i += BATCH_CHUNK_SIZE) {
    const chunk = missing.slice(i, i + BATCH_CHUNK_SIZE)
    const payloads = await heliusGetAssetBatch(heliusUrl, chunk)
    await mapWithConcurrency(chunk, BATCH_JSON_RESOLVE_CONCURRENCY, async (id) => {
      const payload = payloads.get(id)
      const meta = payload
        ? await resolveMintMetaFromDasAssetPayload(payload)
        : { image: null, name: null }
      cacheMintMeta(mintMetaCacheKey(id, preferMainnet), meta)
      out.set(id, meta)
    })
  }

  return out
}
