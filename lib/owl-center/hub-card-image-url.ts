import { arweaveUriToHttps } from '@/lib/nft-media-uri'

const HUB_CARD_FALLBACK = '/images/gen2-logo-mark.png'

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

function isArweaveHttpsUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return h.includes('arweave.')
  } catch {
    return false
  }
}

function arweaveMirrorUrls(url: string): string[] {
  try {
    const u = new URL(url)
    const txPath = u.pathname.replace(/^\//, '') + u.search + u.hash
    if (!txPath || txPath === '/') return []
    const bases = ['gateway.irys.xyz', 'uploader.irys.xyz', 'arweave.dev', 'arweave.net']
    return bases.map((host) => `https://${host}/${txPath}`)
  } catch {
    return []
  }
}

/**
 * Hub cards load creator Arweave art. The default gateway often returns an HTML app shell in-browser;
 * try our image proxy first (sniffs PNG + races gateways), then direct mirrors, then the Gen2 mark.
 */
export function buildOwlCenterHubCardImageChain(imageUrl: string | null | undefined): string[] {
  if (!imageUrl?.trim()) return [HUB_CARD_FALLBACK]

  let url = imageUrl.trim()
  const arHttps = arweaveUriToHttps(url)
  if (arHttps) url = arHttps

  if (url.startsWith('/') && !url.startsWith('//')) {
    return dedupeUrls([url, HUB_CARD_FALLBACK])
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return [HUB_CARD_FALLBACK]
  }

  const chain: string[] = [`/api/proxy-image?url=${encodeURIComponent(url)}`]

  if (isArweaveHttpsUrl(url)) {
    for (const mirror of arweaveMirrorUrls(url)) {
      if (mirror !== url) chain.push(mirror)
    }
  }

  chain.push(url, HUB_CARD_FALLBACK)
  return dedupeUrls(chain)
}

export function owlCenterHubCardFallbackImage(): string {
  return HUB_CARD_FALLBACK
}
