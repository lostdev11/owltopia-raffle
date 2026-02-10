import type { Metadata } from 'next'
import { EnterOwlTopia } from '@/components/EnterOwlTopia'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.owltopia.xyz'

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
    images: [{ url: '/icon.png', width: 512, height: 512, alt: 'Owl Raffle' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Owl Raffle',
    description: 'Trusted raffles with full transparency. Every entry verified on-chain.',
    images: ['/icon.png'],
  },
}

export default function Home() {
  return <EnterOwlTopia />
}
