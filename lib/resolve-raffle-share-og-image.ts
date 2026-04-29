import type { Raffle } from '@/lib/types'
import { getSiteBaseUrl, OG_IMAGE_CACHE_VERSION } from '@/lib/site-config'
export type RaffleShareOgImage = {
  url: string
  width: number
  height: number
  alt: string
  type?: 'image/png'
}

/**
 * Always use the per-slug generated PNG (`opengraph-image`) so X/Discord/Slack show the branded
 * Owltopia card (art + copy + “LIVE ON …”), not a raw listing asset alone.
 */
export function resolveRaffleShareOgImage(raffle: Raffle): RaffleShareOgImage {
  const site = getSiteBaseUrl().replace(/\/$/, '')
  const slug = encodeURIComponent(raffle.slug)
  return {
    url: `${site}/raffles/${slug}/opengraph-image?v=${OG_IMAGE_CACHE_VERSION}`,
    width: 1200,
    height: 630,
    alt: raffle.title,
    type: 'image/png' as const,
  }
}
