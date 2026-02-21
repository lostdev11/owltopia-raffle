import type { Metadata } from 'next'
import { EnterOwlTopia } from '@/components/EnterOwlTopia'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.owltopia.xyz').replace(/\/$/, '')
const OG_IMAGE_PATH = (process.env.NEXT_PUBLIC_OG_IMAGE || '').trim() || '/og-image.png'
const OG_IMAGE_URL = `${SITE_URL}${OG_IMAGE_PATH.startsWith('/') ? OG_IMAGE_PATH : `/${OG_IMAGE_PATH}`}?v=1`
const OG_ALT = 'Owl Raffle - Trusted raffles with full transparency. Every entry verified on-chain.'

export const metadata: Metadata = {
  title: 'Owl Raffle',
  description: `Trusted raffles with full transparency. Every entry verified on-chain. ${SITE_URL}`,
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Owl Raffle',
    title: 'Owl Raffle',
    description: `Trusted raffles with full transparency. Every entry verified on-chain. ${SITE_URL}`,
    images: [{ url: OG_IMAGE_URL, width: 1200, height: 630, alt: OG_ALT, type: 'image/png' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Owl Raffle',
    description: `Trusted raffles with full transparency. Every entry verified on-chain. ${SITE_URL}`,
    images: [{ url: OG_IMAGE_URL, alt: OG_ALT, width: 1200, height: 630 }],
  },
}

export default function Home() {
  return <EnterOwlTopia />
}
