import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import {
  DEFAULT_OG_IMAGE_DIMS,
  DEFAULT_OG_IMAGE_TYPE,
  getDefaultOgImageAbsoluteUrl,
  getSiteBaseUrl,
  OG_ALT,
  PLATFORM_NAME,
} from '@/lib/site-config'

const SITE_URL = getSiteBaseUrl()
const OG_IMAGE = getDefaultOgImageAbsoluteUrl()
const DESCRIPTION =
  'Solana NFT launch infrastructure — presales, phased mints, sellouts, and trading activation for Owltopia Gen2 and future collections.'

export const metadata: Metadata = {
  title: `Owl Center | ${PLATFORM_NAME}`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/owl-center` },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/owl-center`,
    siteName: PLATFORM_NAME,
    title: `Owl Center | ${PLATFORM_NAME}`,
    description: DESCRIPTION,
    images: [{ url: OG_IMAGE, ...DEFAULT_OG_IMAGE_DIMS, alt: OG_ALT, type: DEFAULT_OG_IMAGE_TYPE }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `Owl Center | ${PLATFORM_NAME}`,
    description: DESCRIPTION,
    images: [{ url: OG_IMAGE, alt: OG_ALT, ...DEFAULT_OG_IMAGE_DIMS }],
  },
}

export default function OwlCenterLayout({ children }: { children: ReactNode }) {
  return children
}
