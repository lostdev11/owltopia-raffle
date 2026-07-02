import { buildRaffleImageAttemptChain } from '@/lib/raffle-display-image-url'

/** Proxy races can take ~14s per gateway; allow headroom for canvas export. */
const LOAD_TIMEOUT_MS = 28_000

export function isSameOriginPromoUrl(src: string): boolean {
  const trimmed = src.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true
  if (typeof window === 'undefined') return false
  try {
    return new URL(trimmed, window.location.origin).origin === window.location.origin
  } catch {
    return false
  }
}

/**
 * Canvas export needs same-origin bytes. Listing UI may use direct CDN URLs (no CORS),
 * so cross-origin candidates are fetched via `/api/proxy-image` instead.
 */
export function toPromoCanvasFetchUrl(src: string): string {
  const trimmed = src.trim()
  if (!trimmed) return trimmed
  if (isSameOriginPromoUrl(trimmed)) return trimmed
  return `/api/proxy-image?url=${encodeURIComponent(trimmed)}`
}

function dedupeUrls(urls: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const u of urls) {
    if (!u?.trim() || seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}

function buildPromoPngDisplaySeeds(
  displayAttemptUrls: string[] | null | undefined,
  primaryUrl?: string | null,
  imageFallbackUrl?: string | null
): string[] {
  return dedupeUrls([
    ...(displayAttemptUrls && displayAttemptUrls.length > 0 ? displayAttemptUrls : []),
    ...buildRaffleImageAttemptChain(primaryUrl, imageFallbackUrl ?? null),
  ])
}

/** Ordered fetch URLs for promo PNG canvas art (proxy-wrapped when needed). */
export function buildPromoCanvasImageAttemptChain(
  displayAttemptUrls: string[] | null | undefined,
  primaryUrl?: string | null,
  imageFallbackUrl?: string | null
): string[] {
  const seeds = buildPromoPngDisplaySeeds(displayAttemptUrls, primaryUrl, imageFallbackUrl)
  return dedupeUrls(seeds.map((raw) => toPromoCanvasFetchUrl(raw)))
}

function isLikelyImageContentType(contentType: string): boolean {
  const ct = contentType.trim().toLowerCase()
  if (!ct) return true
  if (ct.startsWith('image/')) return true
  // Many NFT gateways serve PNG/WebP as octet-stream.
  return ct === 'application/octet-stream' || ct === 'binary/octet-stream'
}

async function decodeBlobAsImage(blob: Blob, objectUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const el = new window.Image()
    el.onload = () => {
      resolve(el.naturalWidth >= 2 && el.naturalHeight >= 2 ? el : null)
    }
    el.onerror = () => resolve(null)
    el.src = objectUrl
  })
}

/** crossOrigin image load when fetch+blob fails (e.g. proxy 307 to a CORS-enabled CDN). */
async function tryCrossOriginPromoImage(
  fetchUrl: string,
  sourceUrl: string
): Promise<LoadedPromoImage | null> {
  return new Promise((resolve) => {
    const el = new window.Image()
    el.crossOrigin = 'anonymous'
    el.onload = () => {
      if (el.naturalWidth >= 2 && el.naturalHeight >= 2) {
        resolve({ img: el, sourceUrl, revoke: () => {} })
      } else {
        resolve(null)
      }
    }
    el.onerror = () => resolve(null)
    el.src = fetchUrl
  })
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response | null> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal, cache: 'force-cache' })
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

export type LoadedPromoImage = {
  img: HTMLImageElement
  /** Original display URL (for Solana mark layout detection). */
  sourceUrl: string
  revoke: () => void
}

/** Load raffle/giveaway art for canvas drawing; tries each candidate in order. */
export async function loadPromoPngArt(
  displayAttemptUrls: string[] | null | undefined,
  primaryUrl?: string | null,
  imageFallbackUrl?: string | null
): Promise<LoadedPromoImage | null> {
  if (typeof window === 'undefined') return null

  const seeds = buildPromoPngDisplaySeeds(displayAttemptUrls, primaryUrl, imageFallbackUrl)
  const fetchUrls = dedupeUrls(seeds.map((raw) => toPromoCanvasFetchUrl(raw)))
  const sourceByFetch = new Map<string, string>()
  for (const raw of seeds) {
    sourceByFetch.set(toPromoCanvasFetchUrl(raw), raw)
  }

  for (const fetchUrl of fetchUrls) {
    const sourceUrl = sourceByFetch.get(fetchUrl) ?? fetchUrl
    const res = await fetchWithTimeout(fetchUrl, LOAD_TIMEOUT_MS)
    if (res?.ok) {
      const contentType = res.headers.get('content-type') ?? ''
      let blob: Blob | null = null
      try {
        blob = await res.blob()
      } catch {
        blob = null
      }
      if (blob && blob.size >= 8) {
        const blobType = blob.type || contentType
        if (isLikelyImageContentType(blobType)) {
          const objectUrl = URL.createObjectURL(blob)
          const img = await decodeBlobAsImage(blob, objectUrl)
          if (img) {
            return {
              img,
              sourceUrl,
              revoke: () => URL.revokeObjectURL(objectUrl),
            }
          }
          URL.revokeObjectURL(objectUrl)
        }
      }
    }

    const crossOrigin = await tryCrossOriginPromoImage(fetchUrl, sourceUrl)
    if (crossOrigin) return crossOrigin
  }

  return null
}

/** Same-origin site assets (watermark icon). */
export async function loadPromoPngSiteAsset(src: string): Promise<HTMLImageElement | null> {
  if (typeof window === 'undefined') return null
  const fetchUrl = toPromoCanvasFetchUrl(src)
  const res = await fetchWithTimeout(fetchUrl, 8_000)
  if (!res?.ok) return null
  let blob: Blob
  try {
    blob = await res.blob()
  } catch {
    return null
  }
  const objectUrl = URL.createObjectURL(blob)
  try {
    return await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new window.Image()
      el.onload = () => resolve(el)
      el.onerror = () => resolve(null)
      el.src = objectUrl
    })
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
  }
}
