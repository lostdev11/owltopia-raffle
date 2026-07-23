import type { Metadata } from 'next'
import Link from 'next/link'
import { AuctionsAccessGate } from '@/components/auctions/AuctionsAccessGate'
import { CreateAuctionForm } from '@/components/auctions/CreateAuctionForm'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { PLATFORM_NAME, getSiteBaseUrl } from '@/lib/site-config'

const url = getSiteBaseUrl()

export const metadata: Metadata = {
  title: `Create auction | ${PLATFORM_NAME}`,
  description: `Create a partner auction on ${PLATFORM_NAME}.`,
  alternates: { canonical: `${url}/auctions/new` },
  robots: { index: false, follow: false },
}

export default function CreateAuctionPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <AuctionsAccessGate>
        <Button asChild variant="ghost" className="mb-4 -ml-2 min-h-[44px]">
          <Link href="/auctions">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to auctions
          </Link>
        </Button>
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Create auction</h1>
        <p className="text-sm text-muted-foreground mb-8 max-w-xl">
          Partners only. Deposit the prize to escrow to go live. Optional hidden reserve — bidders
          see whether it is met, not the number. Soft close extends the clock if someone bids in the
          last 5 minutes.
        </p>
        <CreateAuctionForm />
      </AuctionsAccessGate>
    </div>
  )
}
