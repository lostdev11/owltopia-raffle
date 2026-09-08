import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
import { getOwlVisionAdminRole } from '@/lib/admin/access'
import { isOwlSwapPublic } from '@/lib/owl-swap/access'
import { AdminOwlSwapClient } from '@/components/owl-swap/AdminOwlSwapClient'
import { PLATFORM_NAME } from '@/lib/site-config'

export const metadata: Metadata = {
  title: `OwlSwap admin | ${PLATFORM_NAME}`,
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function AdminOwlSwapPage() {
  const session = parseSessionCookieValue((await cookies()).get(SESSION_COOKIE_NAME)?.value)
  const role = session ? await getOwlVisionAdminRole(session.wallet) : null

  return (
    <AdminOwlSwapClient
      initialViewerIsAdmin={Boolean(role)}
      isPublic={isOwlSwapPublic()}
    />
  )
}
