import type { Metadata } from 'next'
import {
  PLATFORM_NAME,
  getSiteBaseUrl,
} from '@/lib/site-config'

const SITE_URL = getSiteBaseUrl()
const OG_IMAGE = `${SITE_URL}/leaderboard-og.png`
const OG_IMAGE_DIMS = { width: 1024, height: 682 }
const OG_ALT = 'Owltopia Leaderboard'

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
    images: [{ url: OG_IMAGE, ...OG_IMAGE_DIMS, alt: OG_ALT, type: 'image/png' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `Leaderboard | ${PLATFORM_NAME}`,
    description: 'Top 10 platform users by raffles entered, raffles created, and tickets sold.',
    images: [{ url: OG_IMAGE, alt: OG_ALT, ...OG_IMAGE_DIMS }],
  },
}

export default function LeaderboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
