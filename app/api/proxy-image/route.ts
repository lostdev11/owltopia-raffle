import { NextRequest, NextResponse } from 'next/server'
import {
  ipfsUriToHttpsGatewayUrl,
  IPFS_HTTPS_GATEWAY_PREFIXES,
  ipfsGatewayCandidateUrls,
  rewriteDeadIpfsGatewayHttpsUrl,
} from '@/lib/ipfs-gateways'
import { arweaveUriToHttps, fullyDecodeURIComponentSafe } from '@/lib/nft-media-uri'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0
/** Vercel Pro (60s). Parallel gateway races use one timeout bucket per URL (see FETCH_TIMEOUT_MS). */
export const maxDuration = 60

/** Max bytes we buffer and return from this route. Vercel Hobby limits response bodies (~4.5MB); stay under to avoid platform 413. */
const DEFAULT_MAX_INLINE_BYTES = 4 * 1024 * 1024
const MAX_INLINE_BYTES = (() => {
  const raw = process.env.IMAGE_PROXY_MAX_INLINE_BYTES?.trim()
  if (!raw) return DEFAULT_MAX_INLINE_BYTES
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_INLINE_BYTES
})()

/** Per upstream URL try; multi-gateway races run in parallel so wall time stays ~one timeout. */
const FETCH_TIMEOUT_MS = 14_000

/** Abort when any of the signals abort (no dependency on AbortSignal.any). */
function abortWhenAny(signals: AbortSignal[]): AbortController {
  const out = new AbortController()
  if (signals.some((s) => s.aborted)) {
    out.abort()
    return out
  }
  for (const s of signals) {
    s.addEventListener('abort', () => out.abort(), { once: true })
  }
  return out
}

class ProxyAttemptError extends Error {
  readonly status: number
  constructor(status: number, message?: string) {
    super(message ?? `proxy ${status}`)
    this.name = 'ProxyAttemptError'
    this.status = status
  }
}
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
])

/** IPFS gateways often return application/octet-stream for images. */
function sniffImageContentType(buffer: ArrayBuffer): string | null {
  const u8 = new Uint8Array(buffer)
  if (u8.length < 12) return null
  // ISO BMFF AVIF (often served as application/octet-stream)
  if (u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) {
    const brand = String.fromCharCode(u8[8] ?? 0, u8[9] ?? 0, u8[10] ?? 0, u8[11] ?? 0).toLowerCase()
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }
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
  if (ar) return rewriteDeadIpfsGatewayHttpsUrl(ar)
  if (trimmed.startsWith('ipfs://')) {
    const converted = ipfsUriToHttpsGatewayUrl(trimmed) ?? trimmed
    return rewriteDeadIpfsGatewayHttpsUrl(converted)
  }
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return rewriteDeadIpfsGatewayHttpsUrl(trimmed)
  }
  if (/^[a-zA-Z0-9]+$/.test(trimmed) && trimmed.length >= 32) {
    return rewriteDeadIpfsGatewayHttpsUrl(`${IPFS_HTTPS_GATEWAY_PREFIXES[0]}${trimmed}`)
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

/** Metaplex / gateways often use https://{node}.arweave.net/{txId} — same origin rules as arweave.net. */
function isArweaveHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return (
    h === 'arweave.net' ||
    h.endsWith('.arweave.net') ||
    h === 'arweave.dev' ||
    h.endsWith('.arweave.dev')
  )
}

/** Whether the target is an Arweave URL (gateways may 403 without Referer). */
function isArweaveUrl(url: string): boolean {
  try {
    return isArweaveHost(new URL(url).hostname)
  } catch {
    return ARWEAVE_GATEWAYS.some((g) => url.startsWith(g))
  }
}

/**
 * NFT metadata often returns subdomain gateways (HTTP/2 quirks in-browser). Race those URLs
 * against canonical arweave.net / arweave.dev paths so the proxy has the same multi-gateway
 * behavior as plain https://arweave.net/{id}.
 */
function expandArweaveProxyUrls(normalizedUrl: string): string[] {
  try {
    const u = new URL(normalizedUrl)
    const h = u.hostname.toLowerCase()
    const pathWithQs = u.pathname + u.search + u.hash
    if (h.endsWith('.arweave.net') && h !== 'arweave.net') {
      const canonical = `https://arweave.net${pathWithQs}`
      return [...new Set([normalizedUrl, ...getArweaveUrls(canonical)])]
    }
    if (h.endsWith('.arweave.dev') && h !== 'arweave.dev') {
      const canonical = `https://arweave.dev${pathWithQs}`
      return [...new Set([normalizedUrl, ...getArweaveUrls(canonical)])]
    }
  } catch {
    /* fall through */
  }
  return getArweaveUrls(normalizedUrl)
}

/**
 * Single upstream attempt. Throws ProxyAttemptError on failure; returns NextResponse on success or redirect.
 */
async function tryProxyOneUrl(tryUrl: string, raceAbort: AbortSignal): Promise<NextResponse> {
  const timeoutCtrl = new AbortController()
  const timeoutId = setTimeout(() => timeoutCtrl.abort(), FETCH_TIMEOUT_MS)
  const combined = abortWhenAny([timeoutCtrl.signal, raceAbort])
  try {
    let res = await fetch(tryUrl, {
      signal: combined.signal,
      headers: { 'User-Agent': 'OwlRaffle/1.0 (Image Proxy)' },
      cache: 'no-store',
    })
    if (!res.ok && res.status === 403 && isArweaveUrl(tryUrl)) {
      const timeout2 = new AbortController()
      const timeoutId2 = setTimeout(() => timeout2.abort(), FETCH_TIMEOUT_MS)
      const combined2 = abortWhenAny([timeout2.signal, raceAbort])
      try {
        res = await fetch(tryUrl, {
          signal: combined2.signal,
          headers: {
            'User-Agent': 'OwlRaffle/1.0 (Image Proxy)',
            Referer: new URL(tryUrl).origin + '/',
          },
          cache: 'no-store',
        })
      } finally {
        clearTimeout(timeoutId2)
      }
    }

    if (!res.ok) {
      throw new ProxyAttemptError(res.status >= 500 ? 502 : 404)
    }

    const contentLength = res.headers.get('content-length')
    const declaredLen = contentLength ? parseInt(contentLength, 10) : NaN
    if (Number.isFinite(declaredLen) && declaredLen > MAX_INLINE_BYTES) {
      await res.body?.cancel().catch(() => {})
      return NextResponse.redirect(tryUrl, 307)
    }

    const buffer = await readBodyUpTo(res, MAX_INLINE_BYTES)
    if (buffer === 'too_large') {
      return NextResponse.redirect(tryUrl, 307)
    }

    const headerCt = res.headers.get('content-type') ?? ''
    const contentType = effectiveImageContentType(headerCt, buffer)
    if (!contentType) {
      throw new ProxyAttemptError(400)
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    })
  } catch (err) {
    if (err instanceof ProxyAttemptError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ProxyAttemptError(504)
    }
    throw new ProxyAttemptError(502)
  } finally {
    clearTimeout(timeoutId)
  }
}

function aggregateProxyFailure(errors: unknown[]): NextResponse {
  const statuses: number[] = []
  for (const e of errors) {
    if (e instanceof ProxyAttemptError) {
      statuses.push(e.status)
    } else if (e instanceof Error && e.name === 'AbortError') {
      statuses.push(504)
    } else {
      statuses.push(502)
    }
  }
  if (statuses.length === 0) {
    return NextResponse.json({ error: 'Image fetch failed' }, { status: 502 })
  }
  if (statuses.every((s) => s === 404)) {
    return NextResponse.json({ error: 'Image fetch failed' }, { status: 404 })
  }
  if (statuses.some((s) => s === 504)) {
    return NextResponse.json({ error: 'Request timeout' }, { status: 504 })
  }
  if (statuses.some((s) => s === 502)) {
    return NextResponse.json({ error: 'Proxy failed' }, { status: 502 })
  }
  if (statuses.some((s) => s === 400)) {
    return NextResponse.json({ error: 'Not an image' }, { status: 400 })
  }
  return NextResponse.json({ error: 'Image fetch failed' }, { status: 404 })
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
      ? expandArweaveProxyUrls(targetStr)
      : getIpfsGatewayUrls(targetStr)

    if (urlsToTry.length === 0) {
      return NextResponse.json({ error: 'Image fetch failed' }, { status: 502 })
    }

    /** First successful gateway wins; others are aborted to save time and bandwidth. */
    const cancelRace = new AbortController()
    try {
      return await Promise.any(
        urlsToTry.map((tryUrl) =>
          tryProxyOneUrl(tryUrl, cancelRace.signal).then((response) => {
            cancelRace.abort()
            return response
          })
        )
      )
    } catch (err) {
      if (err instanceof AggregateError && Array.isArray(err.errors) && err.errors.length > 0) {
        return aggregateProxyFailure(err.errors)
      }
      return NextResponse.json({ error: 'Image fetch failed' }, { status: 502 })
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ error: 'Request timeout' }, { status: 504 })
    }
    console.error('[proxy-image]', err)
    return NextResponse.json({ error: 'Proxy failed' }, { status: 502 })
  }
}
