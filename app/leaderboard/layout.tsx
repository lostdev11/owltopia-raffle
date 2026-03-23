import type { Metadata } from 'next'
import { PLATFORM_NAME, OG_ALT, getSiteBaseUrl, getDefaultOgImageAbsoluteUrl } from '@/lib/site-config'

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
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: OG_ALT, type: 'image/png' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `Leaderboard | ${PLATFORM_NAME}`,
    description: 'Top 10 platform users by raffles entered, raffles created, and tickets sold.',
    images: [{ url: OG_IMAGE, alt: OG_ALT, width: 1200, height: 630 }],
  },
}

export default function LeaderboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
