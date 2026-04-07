import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { countEntriesByGiveawayId, drawCommunityGiveawayWinner, getCommunityGiveawayById } from '@/lib/db/community-giveaways'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/community-giveaways/[id]/draw
 * Weighted random draw among entries. Admin may run anytime while status is open.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const g = await getCommunityGiveawayById(id)
    if (!g) {
      return NextResponse.json({ error: 'Giveaway not found' }, { status: 404 })
    }
    if (g.status !== 'open') {
      return NextResponse.json({ error: 'Giveaway must be open to draw' }, { status: 400 })
    }
    const n = await countEntriesByGiveawayId(id)
    if (n === 0) {
      return NextResponse.json({ error: 'No entries yet' }, { status: 400 })
    }

    const winner = await drawCommunityGiveawayWinner(id)
    if (!winner) {
      return NextResponse.json(
        { error: 'Could not complete draw (already drawn or state changed). Refresh and try again.' },
        { status: 409 }
      )
    }

    const updated = await getCommunityGiveawayById(id)
    return NextResponse.json({
      success: true,
      winnerWallet: winner,
      giveaway: updated,
    })
  } catch (error) {
    console.error('[admin/community-giveaways draw]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
