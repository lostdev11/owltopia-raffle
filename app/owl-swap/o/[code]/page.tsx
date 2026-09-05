import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
import { getOwlVisionAdminRole } from '@/lib/admin/access'
import { isOwlSwapPublic } from '@/lib/owl-swap/access'
import { OwlSwapAcceptClient } from '@/components/owl-swap/OwlSwapAcceptClient'
import { PLATFORM_NAME } from '@/lib/site-config'

type Props = {
  params: Promise<{ code: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params
  return {
    title: `OwlSwap offer ${code} | ${PLATFORM_NAME}`,
    robots: { index: false, follow: false },
  }
}

export const dynamic = 'force-dynamic'

export default async function OwlSwapOfferPage({ params }: Props) {
  const { code } = await params
  const session = parseSessionCookieValue((await cookies()).get(SESSION_COOKIE_NAME)?.value)
  const role = session ? await getOwlVisionAdminRole(session.wallet) : null

  return (
    <OwlSwapAcceptClient
      code={code}
      initialViewerIsAdmin={Boolean(role)}
      isPublic={isOwlSwapPublic()}
    />
  )
}
