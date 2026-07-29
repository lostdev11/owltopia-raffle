import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'
import { isOwlTransferPublic } from '@/lib/owl-transfer/access'
import { OwlTransferClient } from '@/components/owl-transfer/OwlTransferClient'
import { PLATFORM_NAME, getSiteBaseUrl } from '@/lib/site-config'

const SITE_URL = getSiteBaseUrl()
const DESCRIPTION =
  'Send Solana NFTs and tokens with a 0.001 SOL Owl fee — Owl Transfer on Owltopia.'

export const metadata: Metadata = {
  title: `Owl Transfer | ${PLATFORM_NAME}`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/owl-transfer` },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/owl-transfer`,
    siteName: PLATFORM_NAME,
    title: `Owl Transfer | ${PLATFORM_NAME}`,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `Owl Transfer | ${PLATFORM_NAME}`,
    description: DESCRIPTION,
  },
}

export const dynamic = 'force-dynamic'

export default async function OwlTransferPage() {
  const session = parseSessionCookieValue((await cookies()).get(SESSION_COOKIE_NAME)?.value)
  const role = session ? await getAdminRole(session.wallet) : null
  const isPublic = isOwlTransferPublic()

  return (
    <OwlTransferClient
      initialViewerIsAdmin={Boolean(role)}
      isPublic={isPublic}
    />
  )
}
