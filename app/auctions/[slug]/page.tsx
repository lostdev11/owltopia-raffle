import type { Metadata } from 'next'
import { AuctionsAccessGate } from '@/components/auctions/AuctionsAccessGate'
import { AuctionDetailClient } from '@/components/auctions/AuctionDetailClient'
import { PLATFORM_NAME, getSiteBaseUrl } from '@/lib/site-config'

const url = getSiteBaseUrl()

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  return {
    title: `Auction | ${PLATFORM_NAME}`,
    description: `Partner auction on ${PLATFORM_NAME}.`,
    alternates: { canonical: `${url}/auctions/${encodeURIComponent(slug)}` },
    robots: { index: false, follow: false },
  }
}

export default async function AuctionDetailPage({ params }: Props) {
  const { slug } = await params
  return (
    <div className="container mx-auto px-4 py-8">
      <AuctionsAccessGate>
        <AuctionDetailClient slug={slug} />
      </AuctionsAccessGate>
    </div>
  )
}
