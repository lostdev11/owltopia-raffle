import {
  ipfsGatewayCandidateUrls,
  ipfsUriToHttpsGatewayUrl,
  rewriteDeadIpfsGatewayHttpsUrl,
} from '@/lib/ipfs-gateways'
import {
  arweaveUriToHttps,
  fullyDecodeURIComponentSafe,
  irysUploaderMirrorHttpsUrls,
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
            isDirectRaffleImageHost(u.hostname)
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

    if (isDirectRaffleImageHost(u.hostname)) return url

    if (publicSiteOrigin && u.origin === publicSiteOrigin) return url
    if (!publicSiteOrigin && typeof window !== 'undefined' && u.origin === window.location.origin) {
      return url
    }

    return `/api/proxy-image?url=${encodeURIComponent(url)}`
  } catch {
    return url
  }
}

/** When `/api/proxy-image` fails in the browser, try a direct HTTPS URL (gateway for ipfs://). */
export function getRaffleImageFallbackRawUrl(
  displayImageUrl: string | null | undefined,
  _originalImageUrl: string | null | undefined
): string | null {
  const display = displayImageUrl?.trim()
  if (display?.startsWith('/api/proxy-image')) {
    try {
      const parsed = new URL(display, 'https://placeholder.local')
      const raw = parsed.searchParams.get('url')
      if (!raw) return null
      const decoded = rewriteDeadIpfsGatewayHttpsUrl(fullyDecodeURIComponentSafe(raw))
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
  return null
}

/**
 * Ordered URLs to try in the browser when loading raffle artwork (primary, then optional admin fallback).
 * Each logical source adds proxy URL first, then a direct gateway/raw URL when applicable.
 */
export function buildRaffleImageAttemptChain(
  imageUrl: string | null | undefined,
  imageFallbackUrl: string | null | undefined
): string[] {
  const chain: string[] = []
  const addSource = (raw: string | null | undefined) => {
    if (!raw?.trim()) return
    const disp = getRaffleDisplayImageUrl(raw)
    const rawFallback = getRaffleImageFallbackRawUrl(disp, raw)
    if (disp) chain.push(disp)
    if (rawFallback && rawFallback !== disp) chain.push(rawFallback)
  }
  addSource(imageUrl)
  addSource(imageFallbackUrl)

  /** Extra HTTPS gateway URLs for the same IPFS CID (proxy/mobile dead ends are common). */
  const pushIpfsGatewayVariants = (raw: string | null | undefined) => {
    if (!raw?.trim()) return
    let u = rewriteDeadIpfsGatewayHttpsUrl(raw.trim())
    const ar = arweaveUriToHttps(u)
    if (ar) u = ar
    const fromIpfsScheme = /^ipfs:\/\//i.test(u) ? ipfsUriToHttpsGatewayUrl(u) : null
    const seed = fromIpfsScheme ?? u
    if (!/^https?:\/\//i.test(seed) || !seed.includes('/ipfs/')) return
    for (const g of ipfsGatewayCandidateUrls(seed)) {
      chain.push(g)
    }
  }
  pushIpfsGatewayVariants(imageUrl)
  pushIpfsGatewayVariants(imageFallbackUrl)

  const pushIrysMirrors = (raw: string | null | undefined) => {
    if (!raw?.trim()) return
    const u = raw.trim()
    if (!isIrysUploaderHttpsUrl(u)) return
    for (const m of irysUploaderMirrorHttpsUrls(u)) {
      chain.push(m)
    }
  }
  pushIrysMirrors(imageUrl)
  pushIrysMirrors(imageFallbackUrl)

  const deduped: string[] = []
  const seen = new Set<string>()
  for (const u of chain) {
    if (!u?.trim() || seen.has(u)) continue
    seen.add(u)
    deduped.push(u)
  }
  return deduped
}
