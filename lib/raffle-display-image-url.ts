/**
 * Image src for `next/image` on raffle UI. External NFT artwork (IPFS, Arweave, CDNs) is
 * served via `/api/proxy-image` so:
 * - `remotePatterns` does not block the hostname
 * - Mobile / Safe Web are less likely to flag raw gateway URLs
 * - GIF / animated WebP work when combined with `unoptimized` on the proxy URL
 */
export function getRaffleDisplayImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl?.trim()) return null
  const url = imageUrl.trim()

  if (url.startsWith('/api/proxy-image')) return url
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

    if (publicSiteOrigin && u.origin === publicSiteOrigin) return url
    if (!publicSiteOrigin && typeof window !== 'undefined' && u.origin === window.location.origin) {
      return url
    }

    return `/api/proxy-image?url=${encodeURIComponent(url)}`
  } catch {
    return url
  }
}

function ipfsUrlToHttpsGateway(decoded: string): string | null {
  const d = decoded.trim()
  if (!/^ipfs:\/\//i.test(d)) return null
  const path = d.replace(/^ipfs:\/\//i, '').replace(/^ipfs\//i, '')
  if (!path) return null
  return `https://ipfs.io/ipfs/${path}`
}

/** When `/api/proxy-image` fails in the browser, try direct HTTPS (or IPFS via gateway). */
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
      const decoded = decodeURIComponent(raw)
      const ipfsGw = ipfsUrlToHttpsGateway(decoded)
      if (ipfsGw) return ipfsGw
      const u = new URL(decoded)
      if (u.protocol === 'http:' || u.protocol === 'https:') return decoded
    } catch {
      return null
    }
  }
  return null
}
