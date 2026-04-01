import { NextRequest, NextResponse } from 'next/server'
import {
  ipfsUriToHttpsGatewayUrl,
  IPFS_HTTPS_GATEWAY_PREFIXES,
  ipfsGatewayCandidateUrls,
} from '@/lib/ipfs-gateways'
import { arweaveUriToHttps, fullyDecodeURIComponentSafe } from '@/lib/nft-media-uri'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0
/** Vercel Pro (60s). Sequential gateway attempts must fit within this wall clock. */
export const maxDuration = 60

/** Max bytes we buffer and return from this route. Vercel Hobby limits response bodies (~4.5MB); stay under to avoid platform 413. */
const DEFAULT_MAX_INLINE_BYTES = 4 * 1024 * 1024
const MAX_INLINE_BYTES = (() => {
  const raw = process.env.IMAGE_PROXY_MAX_INLINE_BYTES?.trim()
  if (!raw) return DEFAULT_MAX_INLINE_BYTES
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_INLINE_BYTES
})()

/** Per upstream URL try; several gateways may be attempted in series. */
const FETCH_TIMEOUT_MS = 14_000
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])

/** IPFS gateways often return application/octet-stream for images. */
function sniffImageContentType(buffer: ArrayBuffer): string | null {
  const u8 = new Uint8Array(buffer)
  if (u8.length < 12) return null
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'image/jpeg'
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return 'image/png'
  if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x38) return 'image/gif'
  if (
    u8[0] === 0x52 &&
    u8[1] === 0x49 &&
    u8[2] === 0x46 &&
    u8[3] === 0x46 &&
    u8[8] === 0x57 &&
    u8[9] === 0x45 &&
    u8[10] === 0x42 &&
    u8[11] === 0x50
  ) {
    return 'image/webp'
  }
  const textHead = new TextDecoder('utf-8', { fatal: false }).decode(
    u8.slice(0, Math.min(2048, u8.length))
  )
  const trimmedText = textHead.trimStart()
  if (/<svg[\s/>]/i.test(trimmedText) || trimmedText.startsWith('<?xml')) {
    return 'image/svg+xml'
  }
  return null
}

function effectiveImageContentType(headerValue: string, buffer: ArrayBuffer): string | null {
  const t = (headerValue ?? '').split(';')[0].trim().toLowerCase()
  if (ALLOWED_IMAGE_TYPES.has(t) || t.startsWith('image/')) return t
  return sniffImageContentType(buffer)
}

/**
 * Read response body up to maxBytes. Beyond that (or missing body), signals so caller can redirect to upstream.
 * Avoids buffering huge files and keeps responses under serverless body limits.
 */
async function readBodyUpTo(
  res: Response,
  maxBytes: number
): Promise<ArrayBuffer | 'too_large'> {
  const reader = res.body?.getReader()
  if (!reader) {
    const buf = await res.arrayBuffer()
    if (buf.byteLength > maxBytes) return 'too_large'
    return buf
  }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.length) continue
      total += value.length
      if (total > maxBytes) {
        await reader.cancel()
        return 'too_large'
      }
      chunks.push(value)
    }
  } catch {
    await reader.cancel().catch(() => {})
    return 'too_large'
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out.buffer
}

/** Arweave gateways (some block server requests without Referer; we retry with Referer on 403). */
const ARWEAVE_GATEWAYS = [
  'https://arweave.net/',
  'https://arweave.dev/',
] as const

/** Convert ar://, ipfs://, bare CID, or pass through https for fetching. */
function toHttpsImageUrl(url: string): string {
  const trimmed = url.trim()
  const ar = arweaveUriToHttps(trimmed)
  if (ar) return ar
  if (trimmed.startsWith('ipfs://')) {
    return ipfsUriToHttpsGatewayUrl(trimmed) ?? trimmed
  }
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed
  }
  if (/^[a-zA-Z0-9]+$/.test(trimmed) && trimmed.length >= 32) {
    return `${IPFS_HTTPS_GATEWAY_PREFIXES[0]}${trimmed}`
  }
  return trimmed
}

function getIpfsGatewayUrls(normalizedUrl: string): string[] {
  return ipfsGatewayCandidateUrls(normalizedUrl)
}

/** Get URLs to try for Arweave (multiple gateways in case one returns 403). */
function getArweaveUrls(normalizedUrl: string): string[] {
  const urls: string[] = [normalizedUrl]
  try {
    const u = new URL(normalizedUrl)
    if (!u.pathname || u.pathname === '/') return urls
    const path = u.pathname + u.search
    for (const base of ARWEAVE_GATEWAYS) {
      if (normalizedUrl.startsWith(base)) {
        for (const g of ARWEAVE_GATEWAYS) {
          if (g !== base) urls.push(`${g}${path.replace(/^\//, '')}`)
        }
        break
      }
    }
  } catch {
    // keep single url
  }
  return urls
}

/** Whether the target is an Arweave URL (gateways may 403 without Referer). */
function isArweaveUrl(url: string): boolean {
  return ARWEAVE_GATEWAYS.some((g) => url.startsWith(g))
}

/**
 * GET /api/proxy-image?url=<encoded-image-url>
 *
 * Proxies external image URLs (e.g. IPFS) so the browser loads images from our domain.
 * This avoids Safe Web / antivirus flagging IPFS gateway URLs when loading NFT thumbnails.
 *
 * - Only allows http/https (or ipfs:// converted to HTTPS).
 * - Returns only image/* content types.
 * - Bodies larger than ~4MB (see IMAGE_PROXY_MAX_INLINE_BYTES) return 307 to the upstream URL
 *   so the browser loads directly (avoids Vercel response-size 413 and huge buffers).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const rawUrl = searchParams.get('url')

    if (!rawUrl || typeof rawUrl !== 'string') {
      return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
    }

    let targetUrl: URL
    try {
      const decoded = fullyDecodeURIComponentSafe(rawUrl)
      const normalized = toHttpsImageUrl(decoded)
      targetUrl = new URL(normalized)
    } catch {
      return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
    }

    if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
      return NextResponse.json({ error: 'Invalid url scheme' }, { status: 400 })
    }

    const targetStr = targetUrl.toString()
    const urlsToTry = isArweaveUrl(targetStr)
      ? getArweaveUrls(targetStr)
      : getIpfsGatewayUrls(targetStr)
    let lastError: NextResponse | null = null

    for (const tryUrl of urlsToTry) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      try {
        let res = await fetch(tryUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': 'OwlRaffle/1.0 (Image Proxy)' },
          cache: 'no-store',
        })
        // Arweave sometimes returns 403 when no Referer; retry once with Referer
        if (!res.ok && res.status === 403 && isArweaveUrl(tryUrl)) {
          const c2 = new AbortController()
          const t2 = setTimeout(() => c2.abort(), FETCH_TIMEOUT_MS)
          res = await fetch(tryUrl, {
            signal: c2.signal,
            headers: {
              'User-Agent': 'OwlRaffle/1.0 (Image Proxy)',
              Referer: new URL(tryUrl).origin + '/',
            },
            cache: 'no-store',
          })
          clearTimeout(t2)
        }

        if (!res.ok) {
          clearTimeout(timeoutId)
          lastError = NextResponse.json(
            { error: 'Image fetch failed' },
            { status: res.status >= 500 ? 502 : 404 }
          )
          continue
        }

        const contentLength = res.headers.get('content-length')
        const declaredLen = contentLength ? parseInt(contentLength, 10) : NaN
        if (Number.isFinite(declaredLen) && declaredLen > MAX_INLINE_BYTES) {
          clearTimeout(timeoutId)
          await res.body?.cancel().catch(() => {})
          return NextResponse.redirect(tryUrl, 307)
        }

        const buffer = await readBodyUpTo(res, MAX_INLINE_BYTES)
        if (buffer === 'too_large') {
          clearTimeout(timeoutId)
          return NextResponse.redirect(tryUrl, 307)
        }

        const headerCt = res.headers.get('content-type') ?? ''
        const contentType = effectiveImageContentType(headerCt, buffer)
        if (!contentType) {
          clearTimeout(timeoutId)
          lastError = NextResponse.json({ error: 'Not an image' }, { status: 400 })
          continue
        }

        clearTimeout(timeoutId)
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400, s-maxage=86400',
          },
        })
      } catch (err) {
        clearTimeout(timeoutId)
        if (err instanceof Error && err.name === 'AbortError') {
          lastError = NextResponse.json({ error: 'Request timeout' }, { status: 504 })
        } else {
          lastError = NextResponse.json({ error: 'Proxy failed' }, { status: 502 })
        }
      }
    }

    return lastError ?? NextResponse.json({ error: 'Image fetch failed' }, { status: 502 })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ error: 'Request timeout' }, { status: 504 })
    }
    console.error('[proxy-image]', err)
    return NextResponse.json({ error: 'Proxy failed' }, { status: 502 })
  }
}
