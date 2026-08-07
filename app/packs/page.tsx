import type { Metadata } from 'next'
import { PacksClient } from '@/components/packs/PacksClient'
import { PLATFORM_NAME, getSiteBaseUrl } from '@/lib/site-config'

const SITE_URL = getSiteBaseUrl()
const DESCRIPTION =
  'Rip Owl Packs for 0.1 SOL — every pack wins $OWL, SOL, or an NFT. Free raffle tickets on OWL wins.'

export const metadata: Metadata = {
  title: `Owl Packs | ${PLATFORM_NAME}`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/packs` },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/packs`,
    siteName: PLATFORM_NAME,
    title: `Owl Packs | ${PLATFORM_NAME}`,
    description: DESCRIPTION,
  },
}

export const dynamic = 'force-dynamic'

export default function PacksPage() {
  return <PacksClient />
}
