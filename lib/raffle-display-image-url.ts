import {
  ipfsGatewayCandidateUrls,
  ipfsUriToHttpsGatewayUrl,
  rewriteDeadIpfsGatewayHttpsUrl,
} from '@/lib/ipfs-gateways'
import {
  arweaveUriToHttps,
  fullyDecodeURIComponentSafe,
  irysGatewayMirrorHttpsUrls,
  irysUploaderMirrorHttpsUrls,
  isIrysGatewayHttpsUrl,
  isIrysUploaderHttpsUrl,
} from '@/lib/nft-media-uri'

/**
 * Public HTTPS hosts where we load images in the browser instead of `/api/proxy-image`.
 * Firebase/GCS often work in-browser while server-side fetch returns 404 or blocks bots;
 * add matching `images.remotePatterns` in next.config.js for `next/image`.
 */
export function isDirectRaffleImageHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return (
    h === 'firebasestorage.googleapis.com' ||
    h.endsWith('.firebasestorage.app') ||
    h === 'storage.googleapis.com' ||
    h.endsWith('.supabase.co')
  )
}

/** NFT CDN / gateway hosts that load reliably in mobile browsers without the image proxy. */
export function isBrowserDirectRaffleImageHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (isDirectRaffleImageHost(h)) return true
  if (/^[^.]+\.ipfs\.(w3s|nftstorage|dweb|storacha)\.link$/.test(h)) return true
  return (
    h === 'ar-io.net' ||
    h === 'arweave.net' ||
    h === 'arweave.dev' ||
    h.endsWith('.arweave.net') ||
    h.endsWith('.arweave.dev')
  )
}

function dedupeUrls(urls: string[]): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()
  for (const u of urls) {
    if (!u?.trim() || seen.has(u)) continue
    seen.add(u)
    deduped.push(u)
  }
  return deduped
}

function pushHttpsUrl(chain: string[], url: string | null | undefined) {
  if (!url?.trim()) return
  const trimmed = url.trim()
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    chain.push(trimmed)
    return
  }
  try {
    const u = new URL(trimmed)
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      chain.push(u.toString())
    }
  } catch {
    /* ignore */
  }
}

/**
 * Image src for `next/image` on raffle UI. External NFT artwork (IPFS, Arweave, CDNs) is
 * served via `/api/proxy-image` so:
 * - `remotePatterns` does not block the hostname
 * - Mobile / Safe Web are less likely to flag raw gateway URLs
 * - GIF / animated WebP work when combined with `unoptimized` on the proxy URL
 */
export function getRaffleDisplayImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl?.trim()) return null
  let url = rewriteDeadIpfsGatewayHttpsUrl(imageUrl.trim())
  /** `ar://…` is common in Metaplex metadata but is not a valid `<img src>`. */
  const arHttps = arweaveUriToHttps(url)
  if (arHttps) url = arHttps

  // Create flow used to persist `/api/proxy-image?url=...`; server fetch often 404s on Firebase/GCS.
  if (url.startsWith('/api/proxy-image')) {
    try {
      const parsed = new URL(url, 'https://placeholder.local')
      const inner = parsed.searchParams.get('url')
      if (inner) {
        const rawDecoded = fullyDecodeURIComponentSafe(inner)
        const decoded = rewriteDeadIpfsGatewayHttpsUrl(rawDecoded)
        const innerChanged = decoded !== rawDecoded
        try {
          const u = new URL(decoded)
          if (
            (u.protocol === 'http:' || u.protocol === 'https:') &&
            isBrowserDirectRaffleImageHost(u.hostname)
          ) {
            return decoded
          }
        } catch {
          /* keep proxy */
        }
        if (innerChanged) {
          return `/api/proxy-image?url=${encodeURIComponent(decoded)}`
        }
      }
    } catch {
      /* keep proxy */
    }
    return url
  }
  if (url.startsWith('/') && !url.startsWith('//')) return url

  if (/^ipfs:\/\//i.test(url)) {
    return `/api/proxy-image?url=${encodeURIComponent(url)}`
  }

  let publicSiteOrigin = ''
  try {
    const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim()
    if (raw) publicSiteOrigin = new URL(raw.replace(/\/$/, '')).origin
  } catch {
    /* ignore */
  }

  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return url

    if (isIrysGatewayHttpsUrl(url)) {
      return irysGatewayMirrorHttpsUrls(url)[0] ?? url
    }

    if (isBrowserDirectRaffleImageHost(u.hostname)) return url

    if (publicSiteOrigin && u.origin === publicSiteOrigin) return url
    if (!publicSiteOrigin && typeof window !== 'undefined' && u.origin === window.location.origin) {
      return url
    }

    return `/api/proxy-image?url=${encodeURIComponent(url)}`
  } catch {
    return url
  }
}

/**
 * `/api/proxy-image?url=…&w=…` URL for small thumbnails (listing cards, wallet NFT picker).
 * NFT art is frequently a 5–8MB PNG; the proxy downscales it server-side to a few-KB WebP so
 * mobile browsers stop downloading originals for ~100px squares. Returns null when resizing
 * is not applicable (local site assets, or hosts where server-side fetch is unreliable) —
 * callers fall back to the regular display chain.
 */
export function proxyThumbImageUrl(
  imageUrl: string | null | undefined,
  width: number
): string | null {
  if (!imageUrl?.trim()) return null
  const w = Math.round(width)
  if (!Number.isFinite(w) || w <= 0) return null
  let url = imageUrl.trim()

  if (url.startsWith('/api/proxy-image')) {
    try {
      const parsed = new URL(url, 'https://placeholder.local')
      const inner = parsed.searchParams.get('url')
      if (!inner) return null
      url = fullyDecodeURIComponentSafe(inner)
    } catch {
      return null
    }
  }

  // Local site assets (SOL/USDC marks, icons) never need the resize proxy.
  if (url.startsWith('/') && !url.startsWith('//')) return null

  url = rewriteDeadIpfsGatewayHttpsUrl(url)
  const arHttps = arweaveUriToHttps(url)
  if (arHttps) url = arHttps

  if (/^ipfs:\/\//i.test(url)) {
    return `/api/proxy-image?url=${encodeURIComponent(url)}&w=${w}`
  }

  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    // Firebase/GCS/Supabase often 404 or block server-side fetches (see isDirectRaffleImageHost);
    // those hosts stay browser-direct instead of wasting a doomed proxy attempt per thumb.
    if (isDirectRaffleImageHost(u.hostname)) return null
    return `/api/proxy-image?url=${encodeURIComponent(u.toString())}&w=${w}`
  } catch {
    return null
  }
}

/** When `/api/proxy-image` fails in the browser, try a direct HTTPS URL (gateway for ipfs://). */
export function getRaffleImageFallbackRawUrl(
  displayImageUrl: string | null | undefined,
  originalImageUrl: string | null | undefined
): string | null {
  const display = displayImageUrl?.trim()
  if (display?.startsWith('/api/proxy-image')) {
    try {
      const parsed = new URL(display, 'https://placeholder.local')
      const raw = parsed.searchParams.get('url')
      if (!raw) return null
      const decoded = rewriteDeadIpfsGatewayHttpsUrl(fullyDecodeURIComponentSafe(raw))
      if (isIrysGatewayHttpsUrl(decoded)) {
        const mirrors = irysGatewayMirrorHttpsUrls(decoded)
        const arMirror = mirrors.find((m) => m.startsWith('https://arweave.net'))
        if (arMirror && arMirror !== decoded) return arMirror
      }
      if (isIrysUploaderHttpsUrl(decoded)) {
        const mirrors = irysUploaderMirrorHttpsUrls(decoded)
        const arMirror = mirrors.find((m) => m.startsWith('https://arweave.net'))
        if (arMirror && arMirror !== decoded) return arMirror
      }
      const arHttps = arweaveUriToHttps(decoded)
      if (arHttps) return arHttps
      const ipfsHttps = ipfsUriToHttpsGatewayUrl(decoded)
      if (ipfsHttps) return ipfsHttps
      const u = new URL(decoded)
      if (u.protocol === 'http:' || u.protocol === 'https:') return decoded
    } catch {
      return null
    }
  }

  const original = originalImageUrl?.trim()
  if (!original) return null
  let url = rewriteDeadIpfsGatewayHttpsUrl(original)
  const arHttps = arweaveUriToHttps(url)
  if (arHttps) url = arHttps
  if (url === original || url === display) return null
  try {
    const u = new URL(url)
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString()
  } catch {
    return null
  }
  return null
}

/**
 * Ordered URLs to try in the browser when loading raffle artwork (primary, then optional admin fallback).
 * Direct HTTPS URLs (stored metadata, Supabase fallbacks, live IPFS subdomains) are tried before
 * `/api/proxy-image`, which can take ~14s when ipfs.io blocks server-side fetches.
 */
export function buildRaffleImageAttemptChain(
  imageUrl: string | null | undefined,
  imageFallbackUrl: string | null | undefined
): string[] {
  const directCandidates: string[] = []
  const proxyCandidates: string[] = []

  const pushFromRaw = (raw: string | null | undefined) => {
    if (!raw?.trim()) return
    const trimmed = raw.trim()

    if (isIrysGatewayHttpsUrl(trimmed)) {
      for (const mirror of irysGatewayMirrorHttpsUrls(trimmed)) {
        pushHttpsUrl(directCandidates, mirror)
      }
    } else {
      pushHttpsUrl(directCandidates, trimmed)
    }

    let normalized = rewriteDeadIpfsGatewayHttpsUrl(trimmed)
    const arHttps = arweaveUriToHttps(normalized)
    if (arHttps) normalized = arHttps
    pushHttpsUrl(directCandidates, normalized)

    const disp = getRaffleDisplayImageUrl(trimmed)
    if (disp?.startsWith('/api/proxy-image')) {
      proxyCandidates.push(disp)
      pushHttpsUrl(directCandidates, getRaffleImageFallbackRawUrl(disp, trimmed))
    } else {
      pushHttpsUrl(directCandidates, disp)
    }

    for (const gatewayUrl of ipfsGatewayCandidateUrls(trimmed)) {
      pushHttpsUrl(directCandidates, gatewayUrl)
    }

    if (isIrysUploaderHttpsUrl(trimmed)) {
      for (const mirror of irysUploaderMirrorHttpsUrls(trimmed)) {
        pushHttpsUrl(directCandidates, mirror)
      }
    }

    if (isIrysGatewayHttpsUrl(trimmed)) {
      proxyCandidates.push(`/api/proxy-image?url=${encodeURIComponent(trimmed)}`)
    }
  }

  // Admin Supabase fallbacks are reliable — try before slow/dead primary IPFS gateways.
  pushFromRaw(imageFallbackUrl)
  pushFromRaw(imageUrl)

  return dedupeUrls([...directCandidates, ...proxyCandidates])
}
