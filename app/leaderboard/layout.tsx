import type { Metadata } from 'next'
import {
  PLATFORM_NAME,
  OG_ALT,
  DEFAULT_OG_IMAGE_DIMS,
  DEFAULT_OG_IMAGE_TYPE,
  getSiteBaseUrl,
  getDefaultOgImageAbsoluteUrl,
} from '@/lib/site-config'

const SITE_URL = getSiteBaseUrl()
const OG_IMAGE = getDefaultOgImageAbsoluteUrl()

export const metadata: Metadata = {
  title: `Leaderboard | ${PLATFORM_NAME}`,
  description: 'Top 10 platform users by raffles entered, raffles created, and tickets sold.',
  alternates: { canonical: `${SITE_URL}/leaderboard` },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/leaderboard`,
    siteName: PLATFORM_NAME,
    title: `Leaderboard | ${PLATFORM_NAME}`,
    description: 'Top 10 platform users by raffles entered, raffles created, and tickets sold.',
    images: [{ url: OG_IMAGE, ...DEFAULT_OG_IMAGE_DIMS, alt: OG_ALT, type: DEFAULT_OG_IMAGE_TYPE }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `Leaderboard | ${PLATFORM_NAME}`,
    description: 'Top 10 platform users by raffles entered, raffles created, and tickets sold.',
    images: [{ url: OG_IMAGE, alt: OG_ALT, ...DEFAULT_OG_IMAGE_DIMS }],
  },
}

export default function LeaderboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
