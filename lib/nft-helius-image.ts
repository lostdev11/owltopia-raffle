/**
 * Resolve NFT artwork URL via Helius DAS getAsset (server-side).
 */
import { getHeliusRpcUrl } from '@/lib/helius-rpc-url'

export function pickImageFromHeliusAsset(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  const content = r.content as Record<string, unknown> | undefined
  if (!content) return null

  const files = content.files as Array<{ uri?: string; cdn_uri?: string }> | undefined
  const first = files?.[0]
  const fromFile = first?.uri ?? first?.cdn_uri
  if (typeof fromFile === 'string' && fromFile.trim()) return fromFile.trim()

  const metadata = content.metadata as Record<string, unknown> | undefined
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

/**
 * Returns a raw image URI from metadata (may be ipfs://, https, ar://…).
 */
export async function fetchNftImageUriFromHelius(assetId: string): Promise<string | null> {
  const id = assetId.trim()
  if (!id) return null

  const heliusUrl = getHeliusRpcUrl()
  if (!heliusUrl) return null

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
    return pickImageFromHeliusAsset(json.result)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
