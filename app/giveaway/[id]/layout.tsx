import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import {
  PLATFORM_NAME,
  OG_ALT,
  DEFAULT_OG_IMAGE_DIMS,
  DEFAULT_OG_IMAGE_TYPE,
  getSiteBaseUrl,
  getDefaultOgImageAbsoluteUrl,
} from '@/lib/site-config'
import { getNftGiveawayById } from '@/lib/db/nft-giveaways'

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

  const canonicalUrl = `${site}/giveaway/${trimmed}`
  const ogImageUrl = `${canonicalUrl}/opengraph-image`
  let title = `NFT giveaway | ${PLATFORM_NAME}`
  let description = `Claim or view an NFT giveaway on ${PLATFORM_NAME}. Connect the eligible wallet on the giveaway page.`

  try {
    const g = await getNftGiveawayById(trimmed)
    if (g) {
      const t = g.title?.trim() || 'NFT giveaway'
      title = `${t} | ${PLATFORM_NAME}`
      description = `NFT giveaway on ${PLATFORM_NAME}. Open the link and connect your wallet.`
    }
  } catch {
    // Keep generic copy if DB is unavailable.
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
  }
}

export default function LegacyGiveawayLayout({ children }: { children: ReactNode }) {
  return children
}
