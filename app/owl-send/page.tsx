import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
import { getOwlVisionAdminRole } from '@/lib/admin/access'
import { isOwlSendPublic } from '@/lib/owl-send/access'
import { OwlSendClient } from '@/components/owl-send/OwlSendClient'
import { PLATFORM_NAME, getSiteBaseUrl } from '@/lib/site-config'

const SITE_URL = getSiteBaseUrl()
const DESCRIPTION =
  'Send Solana NFTs and tokens with a 0.001 SOL Owl fee — OwlSend on Owltopia.'
/** Dedicated OwlSend link-preview art (`public/owl-send-og.png`). Bump `v` when the asset changes. */
const OG_IMAGE_URL = `${SITE_URL}/owl-send-og.png?v=1`
const OG_IMAGE_DIMS = { width: 1024, height: 682 } as const
const OG_ALT = `OwlSend — send with speed, secure every time. Built on Solana. | ${PLATFORM_NAME}`

export const metadata: Metadata = {
  title: `OwlSend | ${PLATFORM_NAME}`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/owl-send` },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/owl-send`,
    siteName: PLATFORM_NAME,
    title: `OwlSend | ${PLATFORM_NAME}`,
    description: DESCRIPTION,
    images: [{ url: OG_IMAGE_URL, ...OG_IMAGE_DIMS, alt: OG_ALT, type: 'image/png' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `OwlSend | ${PLATFORM_NAME}`,
    description: DESCRIPTION,
    images: [{ url: OG_IMAGE_URL, alt: OG_ALT, ...OG_IMAGE_DIMS }],
  },
}

export const dynamic = 'force-dynamic'

export default async function OwlSendPage() {
  const session = parseSessionCookieValue((await cookies()).get(SESSION_COOKIE_NAME)?.value)
  const role = session ? await getOwlVisionAdminRole(session.wallet) : null
  const isPublic = isOwlSendPublic()

  return (
    <OwlSendClient
      initialViewerIsAdmin={Boolean(role)}
      isPublic={isPublic}
    />
  )
}
