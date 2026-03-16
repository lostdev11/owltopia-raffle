import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_SIZE_BYTES = 15 * 1024 * 1024 // 15MB (many NFT images are 5–10MB)
const FETCH_TIMEOUT_MS = 15_000
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])

const IPFS_GATEWAYS = [
  'https://cloudflare-ipfs.com/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
] as const

/**
 * Convert ipfs:// or IPFS CID to an HTTPS gateway URL (primary: Cloudflare).
 */
function toHttpsImageUrl(url: string): string {
  const trimmed = url.trim()
  if (trimmed.startsWith('ipfs://')) {
    const cid = trimmed.slice(7).replace(/^\/+/, '')
    return `${IPFS_GATEWAYS[0]}${cid}`
  }
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed
  }
  // Could be a bare CID (bafy...); treat as IPFS
  if (/^[a-zA-Z0-9]+$/.test(trimmed) && trimmed.length >= 32) {
    return `${IPFS_GATEWAYS[0]}${trimmed}`
  }
  return trimmed
}

/** Get alternate IPFS gateway URLs for the same CID (for retries). */
function getIpfsGatewayUrls(normalizedUrl: string): string[] {
  const urls: string[] = [normalizedUrl]
  for (const base of IPFS_GATEWAYS) {
    if (normalizedUrl.startsWith(base)) {
      const cid = normalizedUrl.slice(base.length).split('/')[0]
      if (cid) {
        for (const g of IPFS_GATEWAYS) {
          if (g !== base) urls.push(`${g}${cid}`)
        }
      }
      break
    }
  }
  return urls
}

/**
 * GET /api/proxy-image?url=<encoded-image-url>
 *
 * Proxies external image URLs (e.g. IPFS) so the browser loads images from our domain.
 * This avoids Safe Web / antivirus flagging IPFS gateway URLs when loading NFT thumbnails.
 *
 * - Only allows http/https (or ipfs:// converted to HTTPS).
 * - Returns only image/* content types.
 * - Enforces size and timeout limits.
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
      const decoded = decodeURIComponent(rawUrl.trim())
      const normalized = toHttpsImageUrl(decoded)
      targetUrl = new URL(normalized)
    } catch {
      return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
    }

    if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
      return NextResponse.json({ error: 'Invalid url scheme' }, { status: 400 })
    }

    const urlsToTry = getIpfsGatewayUrls(targetUrl.toString())
    let lastError: NextResponse | null = null

    for (const tryUrl of urlsToTry) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      try {
        const res = await fetch(tryUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'OwlRaffle/1.0 (Image Proxy)',
          },
          cache: 'no-store',
        })
        clearTimeout(timeoutId)

        if (!res.ok) {
          lastError = NextResponse.json(
            { error: 'Image fetch failed' },
            { status: res.status >= 500 ? 502 : 404 }
          )
          continue
        }

        const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
        if (!ALLOWED_IMAGE_TYPES.has(contentType) && !contentType.startsWith('image/')) {
          lastError = NextResponse.json({ error: 'Not an image' }, { status: 400 })
          continue
        }

        const contentLength = res.headers.get('content-length')
        if (contentLength && parseInt(contentLength, 10) > MAX_SIZE_BYTES) {
          lastError = NextResponse.json({ error: 'Image too large' }, { status: 413 })
          continue
        }

        const buffer = await res.arrayBuffer()
        if (buffer.byteLength > MAX_SIZE_BYTES) {
          lastError = NextResponse.json({ error: 'Image too large' }, { status: 413 })
          continue
        }

        return new NextResponse(buffer, {
          status: 200,
          headers: {
            'Content-Type': contentType || 'application/octet-stream',
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
