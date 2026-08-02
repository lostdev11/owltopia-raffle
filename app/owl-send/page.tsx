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
  },
  twitter: {
    card: 'summary_large_image',
    title: `OwlSend | ${PLATFORM_NAME}`,
    description: DESCRIPTION,
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
