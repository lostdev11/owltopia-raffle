/**
 * Resolve NFT artwork URL via Helius DAS getAsset (server-side).
 */
import { getHeliusMainnetRpcUrl, getHeliusRpcUrl } from '@/lib/helius-rpc-url'

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

  const files = content.files as Array<{ uri?: string; cdn_uri?: string }> | undefined
  const first = files?.[0]
  const fromFile = first?.uri ?? first?.cdn_uri
  if (typeof fromFile === 'string' && fromFile.trim()) return fromFile.trim()

  const metadata = content.metadata as Record<string, unknown> | undefined

  const fromPropFiles = pickFromPropertiesFiles(metadata)
  if (fromPropFiles) return fromPropFiles

  const metaImg = metadata?.image
  if (typeof metaImg === 'string' && metaImg.trim()) return metaImg.trim()
  if (metaImg && typeof metaImg === 'object' && metaImg !== null) {
    const u = (metaImg as { uri?: string }).uri
    if (typeof u === 'string' && u.trim()) return u.trim()
  }

  const links = content.links as Record<string, unknown> | undefined
  const linkImg = links?.image
  if (typeof linkImg === 'string' && linkImg.trim()) return linkImg.trim()

  return null
}

function extractJsonUriFromDasAsset(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const content = (result as Record<string, unknown>).content as Record<string, unknown> | undefined
  if (!content) return null
  const ju = content.json_uri ?? content.jsonUri
  return typeof ju === 'string' && ju.trim() ? ju.trim() : null
}

const METADATA_JSON_TIMEOUT_MS = 3_500

/** Off-chain TM / Core metadata JSON (`json_uri`) often holds `image` when DAS omits `content.files`. */
async function fetchImageFromMetadataJson(jsonUri: string): Promise<string | null> {
  const u = jsonUri.trim()
  if (!u) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), METADATA_JSON_TIMEOUT_MS)
  try {
    const res = await fetch(u, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json, text/plain;q=0.9,*/*;q=0.8' },
    })
    if (!res.ok) return null
    const data: unknown = await res.json().catch(() => null)
    if (!data || typeof data !== 'object') return null
    const img = (data as { image?: unknown }).image
    return typeof img === 'string' && img.trim() ? img.trim() : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Inline DAS fields first, then optional `json_uri` fetch (Metaplex Core / sparse indexer rows).
 */
export async function resolveImageUriFromDasAssetPayload(result: unknown): Promise<string | null> {
  const inline = pickImageFromHeliusAsset(result)
  if (inline) return inline
  const jsonUri = extractJsonUriFromDasAsset(result)
  if (!jsonUri) return null
  return fetchImageFromMetadataJson(jsonUri)
}

const FETCH_TIMEOUT_MS = 4_500

/** Short TTL cache (same Node process / warm serverless) to avoid repeat DAS getAsset for Discord embeds, etc. */
const IMAGE_URI_CACHE_MAX = 400
const IMAGE_URI_CACHE_TTL_MS = 86_400_000
const imageUriCache = new Map<string, { expiresAt: number; uri: string | null }>()

function cacheImageUri(assetId: string, uri: string | null): void {
  const now = Date.now()
  while (imageUriCache.size >= IMAGE_URI_CACHE_MAX) {
    const first = imageUriCache.keys().next().value as string | undefined
    if (first) imageUriCache.delete(first)
    else break
  }
  // Short TTL on misses so new json_uri fallbacks / indexer fixes apply without waiting a day.
  const ttl = uri === null ? 120_000 : IMAGE_URI_CACHE_TTL_MS
  imageUriCache.set(assetId, { expiresAt: now + ttl, uri })
}

export type FetchNftImageFromHeliusOptions = {
  /** Use mainnet Helius DAS (canonical for prod Owl Nest / TM assets when app RPC is devnet). */
  preferMainnet?: boolean
}

/**
 * Returns a raw image URI from metadata (may be ipfs://, https, ar://…).
 */
export async function fetchNftImageUriFromHelius(
  assetId: string,
  options?: FetchNftImageFromHeliusOptions
): Promise<string | null> {
  const id = assetId.trim()
  if (!id) return null

  const preferMainnet = options?.preferMainnet === true
  const cacheLookupKey = preferMainnet ? `m:${id}` : id

  const heliusUrl = preferMainnet ? getHeliusMainnetRpcUrl() : getHeliusRpcUrl()
  if (!heliusUrl) return null

  const cached = imageUriCache.get(cacheLookupKey)
  if (cached && cached.expiresAt > Date.now()) return cached.uri

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
    const uri = await resolveImageUriFromDasAssetPayload(json.result)
    cacheImageUri(cacheLookupKey, uri)
    return uri
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
