import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { listActiveStakingPools } from '@/lib/db/staking-pools'
import { getAdminRole } from '@/lib/db/admins'
import { isNestingLandingPublic } from '@/lib/db/nesting-public-settings'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
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
const NESTING_PAGE_DESCRIPTION =
  'Land on Owltopia perches, earn OWL over time, and claim whenever you want—Owl Nesting made simple.'

export const metadata: Metadata = {
  title: `Owl Nesting | ${PLATFORM_NAME}`,
  description: NESTING_PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/nesting` },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/nesting`,
    siteName: PLATFORM_NAME,
    title: `Owl Nesting | ${PLATFORM_NAME}`,
    description: NESTING_PAGE_DESCRIPTION,
    images: [{ url: OG_IMAGE_URL, ...DEFAULT_OG_IMAGE_DIMS, alt: OG_ALT, type: DEFAULT_OG_IMAGE_TYPE }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `Owl Nesting | ${PLATFORM_NAME}`,
    description: NESTING_PAGE_DESCRIPTION,
    images: [{ url: OG_IMAGE_URL, alt: OG_ALT, ...DEFAULT_OG_IMAGE_DIMS }],
  },
}

export const dynamic = 'force-dynamic'

export default async function NestingPage() {
  const session = parseSessionCookieValue((await cookies()).get(SESSION_COOKIE_NAME)?.value)
  const role = session ? await getAdminRole(session.wallet) : null
  const landingPublic = await isNestingLandingPublic()
  if (!landingPublic && !role) {
    redirect('/dashboard/nesting')
  }

  const pools = await listActiveStakingPools()
  return <NestingLandingClient initialPools={pools} />
}
