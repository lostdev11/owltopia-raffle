/**
 * Pre-fetches a remote art URL so `next/og` / Satori does not block on a slow
 * `<img src={https...} />` when social crawlers hit the route.
 *
 * `/api/proxy-image` can take many seconds (IPFS gateway races use ~14s per attempt), so the
 * default timeout must exceed the old 2.5s cap or raffle OG art is often empty.
 */
const DEFAULT_UA = 'OwltopiaImageBot/1.0 (+https://owltopia.xyz)'

const DEFAULT_TIMEOUT_MS = 18_000
/** Proxy-image gateway races can take ~14s; match promo PNG headroom. */
const PROXY_ROUTE_TIMEOUT_MS = 30_000
const DEFAULT_MAX_BYTES = 1_500_000

function timeoutForOgFetchUrl(url: string, override?: number): number {
  if (override != null) return override
  if (url.includes('/api/proxy-image')) return PROXY_ROUTE_TIMEOUT_MS
  return DEFAULT_TIMEOUT_MS
}

function isSvg(mime: string, url: string) {
  if (mime === 'image/svg+xml') return true
  if (/\.svg([?#]|$)/i.test(url)) return true
  return false
}

/** Formats Satori (`next/og`) can embed directly. WebP/AVIF must be transcoded first. */
const SATORI_SAFE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif'])

/**
 * Satori cannot decode WebP/AVIF, so embedding that art makes `ImageResponse` throw and the OG route
 * 500s (LunarDollz art is WebP; pinit art is AVIF). Transcode to PNG with sharp. Returns null on
 * failure so callers fall back to the art-less branded card instead of crashing.
 */
async function transcodeToSatoriPngBase64(buf: ArrayBuffer): Promise<string | null> {
  try {
    const { default: sharp } = await import('sharp')
    // The OG card renders art at 400px; cap at 800px (retina) so the PNG stays small/fast for Satori.
    const png = await sharp(Buffer.from(buf))
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return null
  }
}

/** When gateways omit Content-Type or send application/octet-stream (common on IPFS). */
function sniffImageMimeFromBuffer(buf: ArrayBuffer): string | null {
  const u8 = new Uint8Array(buf)
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
  return null
}

/**
 * Returns a `data:` URL for use in Satori's <img/>, or null (placeholder art) on failure/timeout.
 */
export async function fetchImageDataUrlForOg(
  url: string,
  { timeoutMs, maxBytes = DEFAULT_MAX_BYTES }: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<string | null> {
  const s = url.trim()
  if (!s.startsWith('https://') && !s.startsWith('http://')) return null
  if (isSvg('', s)) return null

  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutForOgFetchUrl(s, timeoutMs))
  try {
    const res = await fetch(s, {
      signal: ac.signal,
      headers: {
        'User-Agent': DEFAULT_UA,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    })
    if (!res.ok) return null

    const cl = res.headers.get('content-length')
    if (cl) {
      const n = parseInt(cl, 10)
      if (Number.isFinite(n) && n > maxBytes) return null
    }

    const buf = await res.arrayBuffer()
    if (buf.byteLength < 24 || buf.byteLength > maxBytes) return null

    let mime = (res.headers.get('content-type')?.split(';')[0].trim() ?? '').toLowerCase()
    if (!mime || mime === 'application/octet-stream' || !mime.startsWith('image/')) {
      const sniffed = sniffImageMimeFromBuffer(buf)
      if (sniffed) mime = sniffed
    }
    if (!mime.startsWith('image/')) return null
    if (isSvg(mime, s)) return null

    // Satori only embeds PNG/JPEG/GIF; transcode anything else (WebP, AVIF, …) to PNG.
    if (!SATORI_SAFE_MIMES.has(mime)) {
      return await transcodeToSatoriPngBase64(buf)
    }

    const b64 = Buffer.from(buf).toString('base64')
    return `data:${mime};base64,${b64}`
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}
