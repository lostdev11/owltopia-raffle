import type { Metadata } from 'next'
import { AuctionsAccessGate } from '@/components/auctions/AuctionsAccessGate'
import { AuctionsListClient } from '@/components/auctions/AuctionsListClient'
import { PLATFORM_NAME, getSiteBaseUrl } from '@/lib/site-config'

const url = getSiteBaseUrl()

export const metadata: Metadata = {
  title: `Partner auctions | ${PLATFORM_NAME}`,
  description: `Partner-only English auctions for NFTs, SOL, and USDC on ${PLATFORM_NAME}.`,
  alternates: { canonical: `${url}/auctions` },
  robots: { index: false, follow: false },
}

export default function AuctionsPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <AuctionsAccessGate>
        <AuctionsListClient />
      </AuctionsAccessGate>
    </div>
  )
}
