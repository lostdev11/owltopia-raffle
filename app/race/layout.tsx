import type { Metadata } from 'next'
import { PLATFORM_NAME, getSiteBaseUrl } from '@/lib/site-config'

const SITE_URL = getSiteBaseUrl()

export const metadata: Metadata = {
  title: `Flight League | ${PLATFORM_NAME}`,
  description:
    'A holder-gated Owltopia owl racing experience with verified seasonal time trials.',
  alternates: { canonical: `${SITE_URL}/race` },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/race`,
    siteName: PLATFORM_NAME,
    title: `Flight League | ${PLATFORM_NAME}`,
    description:
      'Run, jump, glide, and compete in verified Owltopia seasonal time trials.',
  },
}

export default function RaceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
