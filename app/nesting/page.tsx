import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { listActiveStakingPools } from '@/lib/db/staking-pools'
import { getAdminRole } from '@/lib/db/admins'
import { isNestingLandingPublic } from '@/lib/db/nesting-public-settings'
import { getNestingActionsPauseBreakdown } from '@/lib/nesting/policy'
import { getOwlNest365PublicStats } from '@/lib/nesting/owl-nest-365-stats'
import { getGenOwlNestPublicStatsByGroup } from '@/lib/nesting/gen-owl-nest-stats'
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

  const [pools, pause, owlNest365Stats, genOwlNestStats] = await Promise.all([
    listActiveStakingPools({ includeAdminOnlyPools: Boolean(role) }),
    getNestingActionsPauseBreakdown(),
    getOwlNest365PublicStats(),
    getGenOwlNestPublicStatsByGroup(),
  ])
  return (
    <NestingLandingClient
      initialPools={pools}
      initialOwlNest365Stats={owlNest365Stats}
      initialGenOwlNestStats={genOwlNestStats}
      nestingDisabled={pause.disabled}
      nestingPausedByDeployEnv={pause.envKillSwitch}
      nestingPausedByAdmin={pause.adminDbPaused}
      viewerIsAdmin={Boolean(role)}
    />
  )
}
