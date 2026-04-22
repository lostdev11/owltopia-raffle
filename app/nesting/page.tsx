import type { Metadata } from 'next'
import { listActiveStakingPools } from '@/lib/db/staking-pools'
import { NestingLandingClient } from '@/components/nesting/NestingLandingClient'
import {
  PLATFORM_NAME,
  OG_ALT,
  DEFAULT_OG_IMAGE_DIMS,
  DEFAULT_OG_IMAGE_TYPE,
  getSiteBaseUrl,
  getDefaultOgImageAbsoluteUrl,
} from '@/lib/site-config'

const SITE_URL = getSiteBaseUrl()
const OG_IMAGE_URL = getDefaultOgImageAbsoluteUrl()

export const metadata: Metadata = {
  title: `Owl Nesting | ${PLATFORM_NAME}`,
  description:
    'Stake toward Owltopia ecosystem pools — MVP uses secure database records; on-chain custody comes later.',
  alternates: { canonical: `${SITE_URL}/nesting` },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/nesting`,
    siteName: PLATFORM_NAME,
    title: `Owl Nesting | ${PLATFORM_NAME}`,
    description:
      'Stake toward Owltopia ecosystem pools — MVP uses secure database records; on-chain custody comes later.',
    images: [{ url: OG_IMAGE_URL, ...DEFAULT_OG_IMAGE_DIMS, alt: OG_ALT, type: DEFAULT_OG_IMAGE_TYPE }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `Owl Nesting | ${PLATFORM_NAME}`,
    images: [{ url: OG_IMAGE_URL, alt: OG_ALT, ...DEFAULT_OG_IMAGE_DIMS }],
  },
}

export const dynamic = 'force-dynamic'

export default async function NestingPage() {
  const pools = await listActiveStakingPools()
  return <NestingLandingClient initialPools={pools} />
}
