import { buildRaffleImageAttemptChain } from '@/lib/raffle-display-image-url'

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

/**
 * Server-side OG/Satori fetch URL. External artwork goes through `/api/proxy-image` (same as promo
 * PNG canvas) so Firebase/GCS/IPFS gateways that block bots still resolve during link-preview generation.
 */
export function toOgArtFetchUrl(src: string, siteBase: string): string | null {
  const trimmed = src.trim()
  if (!trimmed) return null

  const base = siteBase.replace(/\/$/, '')
  let siteOrigin = base
  try {
    siteOrigin = new URL(base).origin
  } catch {
    /* keep base string */
  }

  if (trimmed.startsWith('/api/proxy-image')) {
    return `${base}${trimmed}`
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return `${base}${trimmed}`
  }

  try {
    const u = new URL(trimmed)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (u.origin === siteOrigin) return u.toString()
    return `${base}/api/proxy-image?url=${encodeURIComponent(u.toString())}`
  } catch {
    return null
  }
}

/** Ordered absolute fetch URLs for raffle OG art (proxy-wrapped when needed). */
export function buildOgArtFetchAttemptChain(
  siteBase: string,
  imageUrl: string | null | undefined,
  imageFallbackUrl: string | null | undefined
): string[] {
  const seeds = buildRaffleImageAttemptChain(imageUrl, imageFallbackUrl)
  return dedupeUrls(seeds.map((raw) => toOgArtFetchUrl(raw, siteBase)).filter((u): u is string => Boolean(u)))
}
