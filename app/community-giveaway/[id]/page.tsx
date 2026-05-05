import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { CommunityGiveawayPageClient } from '@/components/community-giveaway/CommunityGiveawayPageClient'
import {
  buildCommunityGiveawayMeStatus,
  loadCommunityGiveawayPageBundle,
} from '@/lib/community-giveaways/page-data'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
import { getEntryForWallet } from '@/lib/db/community-giveaways'

/** Same rendering model as `/raffles/[slug]`: server loads giveaway + auto-draw, client handles wallet actions. */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function CommunityGiveawayPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const trimmed = typeof id === 'string' ? id.trim() : ''
  if (!trimmed) {
    notFound()
  }

  const bundle = await loadCommunityGiveawayPageBundle(trimmed)
  if (!bundle) {
    notFound()
  }

  const sessionValue = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  const session = parseSessionCookieValue(sessionValue)
  const sessionWallet = session?.wallet ?? null

  let initialMeStatus = null
  if (sessionWallet) {
    const entry = await getEntryForWallet(trimmed, sessionWallet)
    initialMeStatus = buildCommunityGiveawayMeStatus(bundle.giveaway, sessionWallet, entry)
  }

  return (
    <CommunityGiveawayPageClient
      giveawayId={trimmed}
      initialPublicInfo={bundle.publicInfo}
      sessionWallet={sessionWallet}
      initialMeStatus={initialMeStatus}
    />
  )
}
