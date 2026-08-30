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
/** Dedicated Packs link-preview art (`public/packs-og.jpg`). Bump `v` when the asset changes. */
const OG_IMAGE_URL = `${SITE_URL}/packs-og.jpg?v=1`
const OG_IMAGE_DIMS = { width: 1024, height: 682 } as const
const OG_ALT = `Owl Packs — Unlock. Open. Win. | ${PLATFORM_NAME}`

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
    images: [{ url: OG_IMAGE_URL, ...OG_IMAGE_DIMS, alt: OG_ALT, type: 'image/jpeg' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `Owl Packs | ${PLATFORM_NAME}`,
    description: DESCRIPTION,
    images: [{ url: OG_IMAGE_URL, alt: OG_ALT, ...OG_IMAGE_DIMS }],
  },
}

export const dynamic = 'force-dynamic'

export default async function PacksPage() {
  const session = parseSessionCookieValue((await cookies()).get(SESSION_COOKIE_NAME)?.value)
  const role = session ? await getOwlVisionAdminRole(session.wallet) : null
  const isPublic = await isPacksPublic()

  return (
    <PacksClient
      initialViewerIsAdmin={Boolean(role)}
      isPublic={isPublic}
    />
  )
}
