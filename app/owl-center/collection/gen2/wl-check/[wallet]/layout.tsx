import type { ReactNode } from 'react'
import type { Metadata } from 'next'

import { buildGen2WlCheckShareSnapshot, gen2WlCheckSharePath } from '@/lib/owl-center/gen2-wl-check-share'
import {
  DEFAULT_OG_IMAGE_DIMS,
  DEFAULT_OG_IMAGE_TYPE,
  OG_IMAGE_CACHE_VERSION,
  PLATFORM_NAME,
  getDefaultOgImageAbsoluteUrl,
  getSiteBaseUrl,
} from '@/lib/site-config'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ wallet: string }>
}): Promise<Metadata> {
  const { wallet: walletParam } = await params
  const walletRaw = typeof walletParam === 'string' ? decodeURIComponent(walletParam.trim()) : ''
  const snapshot = await buildGen2WlCheckShareSnapshot(walletRaw)
  const site = getSiteBaseUrl()
  const defaultImg = getDefaultOgImageAbsoluteUrl()

  if (!snapshot.wallet) {
    return {
      title: snapshot.metadata.title,
      description: snapshot.metadata.description,
      openGraph: {
        images: [{ url: defaultImg, ...DEFAULT_OG_IMAGE_DIMS, alt: PLATFORM_NAME, type: DEFAULT_OG_IMAGE_TYPE }],
      },
      twitter: {
        card: 'summary_large_image',
        images: [{ url: defaultImg, alt: PLATFORM_NAME, ...DEFAULT_OG_IMAGE_DIMS }],
      },
    }
  }

  const canonicalUrl = `${site}${gen2WlCheckSharePath(snapshot.wallet)}`
  const ogImageUrl = `${canonicalUrl}/opengraph-image?v=${OG_IMAGE_CACHE_VERSION}`

  return {
    title: snapshot.metadata.title,
    description: snapshot.metadata.description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: 'website',
      url: canonicalUrl,
      siteName: PLATFORM_NAME,
      title: snapshot.metadata.title,
      description: snapshot.metadata.description,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: snapshot.og.line1,
          type: 'image/png',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: snapshot.metadata.title,
      description: snapshot.metadata.description,
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: snapshot.og.line1 }],
    },
    other: { 'twitter:url': canonicalUrl },
  }
}

export default function Gen2WlCheckShareLayout({ children }: { children: ReactNode }) {
  return children
}
