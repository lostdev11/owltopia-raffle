import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'
import { isOwlSendPublic } from '@/lib/owl-send/access'
import { AdminOwlSendClient } from '@/components/owl-send/AdminOwlSendClient'
import { PLATFORM_NAME } from '@/lib/site-config'

export const metadata: Metadata = {
  title: `OwlSend admin | ${PLATFORM_NAME}`,
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function AdminOwlSendPage() {
  const session = parseSessionCookieValue((await cookies()).get(SESSION_COOKIE_NAME)?.value)
  const role = session ? await getAdminRole(session.wallet) : null

  return (
    <AdminOwlSendClient
      initialViewerIsAdmin={Boolean(role)}
      isPublic={isOwlSendPublic()}
    />
  )
}
