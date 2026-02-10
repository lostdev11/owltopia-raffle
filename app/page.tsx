import type { Metadata } from 'next'
import { EnterOwlTopia } from '@/components/EnterOwlTopia'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.owltopia.xyz').replace(/\/$/, '')
const OG_IMAGE = `${SITE_URL}/icon.png`

export const metadata: Metadata = {
  title: 'Owl Raffle',
  description: 'Trusted raffles with full transparency. Every entry verified on-chain.',
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Owl Raffle',
    title: 'Owl Raffle',
    description: 'Trusted raffles with full transparency. Every entry verified on-chain.',
    images: [
      { url: OG_IMAGE, width: 512, height: 512, alt: 'Owl Raffle', type: 'image/png' },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Owl Raffle',
    description: 'Trusted raffles with full transparency. Every entry verified on-chain.',
    images: [OG_IMAGE],
  },
}

export default function Home() {
  return <EnterOwlTopia />
}
