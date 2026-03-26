import type { Metadata } from 'next'
import { EnterOwlTopia } from '@/components/EnterOwlTopia'
import {
  PLATFORM_NAME,
  OG_ALT,
  DEFAULT_OG_IMAGE_DIMS,
  DEFAULT_OG_IMAGE_TYPE,
  getSiteBaseUrl,
  getDefaultOgImageAbsoluteUrl,
} from '@/lib/site-config'

const SITE_URL = getSiteBaseUrl()
const OG_IMAGE_URL = getDefaultOgImageAbsoluteUrl()

export const metadata: Metadata = {
  title: PLATFORM_NAME,
  description: `Trusted raffles with full transparency. Every entry verified on-chain. ${SITE_URL}`,
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: PLATFORM_NAME,
    title: PLATFORM_NAME,
    description: `Trusted raffles with full transparency. Every entry verified on-chain. ${SITE_URL}`,
    images: [{ url: OG_IMAGE_URL, ...DEFAULT_OG_IMAGE_DIMS, alt: OG_ALT, type: DEFAULT_OG_IMAGE_TYPE }],
  },
  twitter: {
    card: 'summary_large_image',
    title: PLATFORM_NAME,
    description: `Trusted raffles with full transparency. Every entry verified on-chain. ${SITE_URL}`,
    images: [{ url: OG_IMAGE_URL, alt: OG_ALT, ...DEFAULT_OG_IMAGE_DIMS }],
  },
}

export default function Home() {
  return <EnterOwlTopia />
}
