import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { buildCommunityGiveawayMeStatus } from '@/lib/community-giveaways/page-data'
import { getCommunityGiveawayById, getEntryForWallet } from '@/lib/db/community-giveaways'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * GET /api/me/community-giveaways/[id]/status
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connectedWallet = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (connectedWallet && connectedWallet !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session. Please sign in again.' },
        { status: 401 }
      )
    }

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const g = await getCommunityGiveawayById(id)
    if (!g || g.status === 'draft') {
      return NextResponse.json({ error: 'Giveaway not found' }, { status: 404 })
    }

    const wallet = session.wallet.trim()
    const entry = await getEntryForWallet(id, wallet)
    return NextResponse.json(buildCommunityGiveawayMeStatus(g, wallet, entry))
  } catch (error) {
    console.error('[me/community-giveaways status]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
