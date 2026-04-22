/**
 * Resolve NFT artwork URL via Helius DAS getAsset (server-side).
 */
import { getHeliusRpcUrl } from '@/lib/helius-rpc-url'

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
  imageUriCache.set(assetId, { expiresAt: now + IMAGE_URI_CACHE_TTL_MS, uri })
}

/**
 * Returns a raw image URI from metadata (may be ipfs://, https, ar://…).
 */
export async function fetchNftImageUriFromHelius(assetId: string): Promise<string | null> {
  const id = assetId.trim()
  if (!id) return null

  const heliusUrl = getHeliusRpcUrl()
  if (!heliusUrl) return null

  const cached = imageUriCache.get(id)
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
    const uri = pickImageFromHeliusAsset(json.result)
    cacheImageUri(id, uri)
    return uri
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
