import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
import { getOwlVisionAdminRole } from '@/lib/admin/access'
import { isOwlSwapPublic } from '@/lib/owl-swap/access'
import { OwlSwapClient } from '@/components/owl-swap/OwlSwapClient'
import { PLATFORM_NAME, getSiteBaseUrl } from '@/lib/site-config'

const SITE_URL = getSiteBaseUrl()
const DESCRIPTION =
  'Peer-to-peer Solana NFT swaps — 0.02 SOL Owl fee (Owltopia holders up to 50% off) — OwlSwap on Owltopia.'

export const metadata: Metadata = {
  title: `OwlSwap | ${PLATFORM_NAME}`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/owl-swap` },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/owl-swap`,
    siteName: PLATFORM_NAME,
    title: `OwlSwap | ${PLATFORM_NAME}`,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `OwlSwap | ${PLATFORM_NAME}`,
    description: DESCRIPTION,
  },
}

export const dynamic = 'force-dynamic'

export default async function OwlSwapPage() {
  const session = parseSessionCookieValue((await cookies()).get(SESSION_COOKIE_NAME)?.value)
  const role = session ? await getOwlVisionAdminRole(session.wallet) : null
  const isPublic = isOwlSwapPublic()

  return (
    <OwlSwapClient initialViewerIsAdmin={Boolean(role)} isPublic={isPublic} />
  )
}
