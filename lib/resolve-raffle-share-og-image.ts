import type { Raffle } from '@/lib/types'
import { getSiteBaseUrl } from '@/lib/site-config'
import { getPartnerPrizeListingImageUrl, isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import { isUnsupportedSocialCardImageUrl } from '@/lib/social-card-image'

function absoluteUrl(siteBase: string, pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl?.trim()) return null
  const t = pathOrUrl.trim()
  if (t.startsWith('http://') || t.startsWith('https://')) return t
  const base = siteBase.replace(/\/$/, '')
  const path = t.startsWith('/') ? t : `/${t}`
  return `${base}${path}`
}

export type RaffleShareOgImage = {
  url: string
  width: number
  height: number
  alt: string
  type?: 'image/png'
}

/**
 * Picks an X/Twitter-safe og:image URL: raster listing images or the per-slug generated opengraph-image.
 */
export function resolveRaffleShareOgImage(raffle: Raffle): RaffleShareOgImage {
  const site = getSiteBaseUrl().replace(/\/$/, '')
  const slug = raffle.slug
  const ordered = [absoluteUrl(site, raffle.image_url), absoluteUrl(site, raffle.image_fallback_url)].filter(
    (u): u is string => Boolean(u)
  )
  for (const url of ordered) {
    if (!isUnsupportedSocialCardImageUrl(url)) {
      return { url, width: 1200, height: 630, alt: raffle.title }
    }
  }
  if (isPartnerSplPrizeRaffle(raffle)) {
    const rel = getPartnerPrizeListingImageUrl(raffle.prize_currency)
    const staticAbs = `${site}${rel.startsWith('/') ? rel : `/${rel}`}`
    if (!isUnsupportedSocialCardImageUrl(staticAbs)) {
      return { url: staticAbs, width: 1200, height: 630, alt: raffle.title, type: 'image/png' as const }
    }
  }
  return {
    url: `${site}/raffles/${slug}/opengraph-image`,
    width: 1200,
    height: 630,
    alt: raffle.title,
    type: 'image/png' as const,
  }
}
