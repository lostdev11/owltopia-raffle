import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import {
  PLATFORM_NAME,
  OG_ALT,
  DEFAULT_OG_IMAGE_DIMS,
  DEFAULT_OG_IMAGE_TYPE,
  OG_IMAGE_CACHE_VERSION,
  getSiteBaseUrl,
  getDefaultOgImageAbsoluteUrl,
} from '@/lib/site-config'
import { getCommunityGiveawayById } from '@/lib/db/community-giveaways'

const site = getSiteBaseUrl()

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const trimmed = typeof id === 'string' ? id.trim() : ''
  const defaultImg = getDefaultOgImageAbsoluteUrl()
  if (!trimmed) {
    return {
      title: `Giveaway | ${PLATFORM_NAME}`,
      openGraph: {
        images: [{ url: defaultImg, ...DEFAULT_OG_IMAGE_DIMS, alt: OG_ALT, type: DEFAULT_OG_IMAGE_TYPE }],
      },
      twitter: {
        card: 'summary_large_image',
        images: [{ url: defaultImg, alt: OG_ALT, ...DEFAULT_OG_IMAGE_DIMS }],
      },
    }
  }

  const canonicalUrl = `${site}/community-giveaway/${trimmed}`
  const ogImageUrl = `${canonicalUrl}/opengraph-image?v=${OG_IMAGE_CACHE_VERSION}`
  let title = `Community giveaway | ${PLATFORM_NAME}`
  let description = `Join a community giveaway on ${PLATFORM_NAME}. Connect your wallet on the giveaway page.`

  try {
    const g = await getCommunityGiveawayById(trimmed)
    if (g && g.status !== 'draft') {
      const t = g.title?.trim() || 'Community giveaway'
      title = `${t} | ${PLATFORM_NAME}`
      description =
        g.description?.replace(/\s+/g, ' ').trim().slice(0, 200) ||
        `Join this community giveaway on ${PLATFORM_NAME}. Connect your wallet on the giveaway page.`
    }
  } catch {
    // If the DB is unavailable, keep generic copy; opengraph-image still returns a branded card.
  }

  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: 'website',
      url: canonicalUrl,
      siteName: PLATFORM_NAME,
      title,
      description,
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title, type: 'image/png' }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title }],
    },
    other: { 'twitter:url': canonicalUrl },
  }
}

export default function CommunityGiveawayLayout({ children }: { children: ReactNode }) {
  return children
}
