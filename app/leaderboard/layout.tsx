import type { Metadata } from 'next'
import { PLATFORM_NAME } from '@/lib/site-config'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.owltopia.xyz').replace(/\/$/, '')

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
  },
}

export default function LeaderboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
