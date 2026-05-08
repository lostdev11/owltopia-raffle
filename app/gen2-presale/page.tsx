import { cookies } from 'next/headers'

import { Gen2PresalePageClient } from '@/components/gen2-presale/Gen2PresalePageClient'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
import { isGen2PresaleAdmin } from '@/lib/gen2-presale/admin-auth'

export const dynamic = 'force-dynamic'

export default async function Gen2PresalePage() {
  const session = parseSessionCookieValue((await cookies()).get(SESSION_COOKIE_NAME)?.value)
  const showAdminPausedNote = session ? await isGen2PresaleAdmin(session.wallet) : false

  return <Gen2PresalePageClient showAdminPausedNote={showAdminPausedNote} />
}
