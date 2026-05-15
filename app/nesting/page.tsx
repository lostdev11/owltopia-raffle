import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { listActiveStakingPools } from '@/lib/db/staking-pools'
import { getAdminRole } from '@/lib/db/admins'
import { isNestingLandingPublic } from '@/lib/db/nesting-public-settings'
import { isNestingGloballyDisabled } from '@/lib/nesting/policy'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
import { NestingLandingClient } from '@/components/nesting/NestingLandingClient'
import {
  PLATFORM_NAME,
  getSiteBaseUrl,
} from '@/lib/site-config'

const SITE_URL = getSiteBaseUrl()
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
  },
  twitter: {
    card: 'summary_large_image',
    title: `Owl Nesting | ${PLATFORM_NAME}`,
    description: NESTING_PAGE_DESCRIPTION,
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
  const nestingDisabled = await isNestingGloballyDisabled()
  return <NestingLandingClient initialPools={pools} nestingDisabled={nestingDisabled} />
}
