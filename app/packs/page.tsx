import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { PacksClient } from '@/components/packs/PacksClient'
import { getOwlVisionAdminRole } from '@/lib/admin/access'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
import { isPacksPublic } from '@/lib/packs/access'
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

export default async function PacksPage() {
  const session = parseSessionCookieValue((await cookies()).get(SESSION_COOKIE_NAME)?.value)
  const role = session ? await getOwlVisionAdminRole(session.wallet) : null
  const isPublic = isPacksPublic()

  return (
    <PacksClient
      initialViewerIsAdmin={Boolean(role)}
      isPublic={isPublic}
    />
  )
}
