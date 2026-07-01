import {
  arweaveUriToHttps,
  irysGatewayMirrorHttpsUrls,
  isIrysGatewayHttpsUrl,
  unwrapHeliusCdnImageUrl,
} from '@/lib/nft-media-uri'

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

/** Browser-direct mirrors — omit arweave.net/dev (often return a 200 HTML shell, no onerror). */
function arweaveMirrorUrls(url: string): string[] {
  try {
    const u = new URL(url)
    const txPath = u.pathname.replace(/^\//, '') + u.search + u.hash
    if (!txPath || txPath === '/') return []
    const bases = ['gateway.irys.xyz', 'uploader.irys.xyz', 'ar-io.net']
    return bases.map((host) => `https://${host}/${txPath}`)
  } catch {
    return []
  }
}

/**
 * Hub cards load creator Arweave art. The default gateway often returns an HTML app shell in-browser;
 * try our image proxy first (sniffs PNG + races gateways), then direct mirrors, then the Gen2 mark.
 */
export function buildOwlCenterHubCardImageChain(
  imageUrl: string | null | undefined,
  options?: { includeFallback?: boolean }
): string[] {
  const includeFallback = options?.includeFallback !== false
  if (!imageUrl?.trim()) return includeFallback ? [HUB_CARD_FALLBACK] : []

  let url = imageUrl.trim()
  const arHttps = arweaveUriToHttps(url)
  if (arHttps) url = arHttps

  if (url.startsWith('/') && !url.startsWith('//')) {
    return dedupeUrls(includeFallback ? [url, HUB_CARD_FALLBACK] : [url])
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return includeFallback ? [HUB_CARD_FALLBACK] : []
  }

  // 1) Server proxy (sniffs PNG + races gateways). Skip raw arweave.net/dev in-browser — they
  // often return a 200 HTML app shell (broken <img>, no onerror).
  const chain: string[] = [`/api/proxy-image?url=${encodeURIComponent(url)}`]
  if (!isArweaveHttpsUrl(url)) {
    chain.push(url)
  }

  // 2) Deep fallbacks: if the URL is a Helius CDN wrapper, fall back to the underlying
  // gateway URL and its mirrors; otherwise mirror the gateway URL directly.
  const inner = unwrapHeliusCdnImageUrl(url)
  const seed = inner ?? url
  if (inner) chain.push(inner)
  if (isIrysGatewayHttpsUrl(seed)) {
    for (const mirror of irysGatewayMirrorHttpsUrls(seed)) chain.push(mirror)
  } else if (isArweaveHttpsUrl(seed)) {
    for (const mirror of arweaveMirrorUrls(seed)) chain.push(mirror)
  }

  if (includeFallback) chain.push(HUB_CARD_FALLBACK)
  return dedupeUrls(chain)
}

export function owlCenterHubCardFallbackImage(): string {
  return HUB_CARD_FALLBACK
}
