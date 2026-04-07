import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import {
  getCommunityGiveawayById,
  getEntryForWallet,
  insertCommunityGiveawayEntry,
} from '@/lib/db/community-giveaways'
import { canJoinCommunityGiveaway } from '@/lib/community-giveaways/eligibility'
import { rateLimit } from '@/lib/rate-limit'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * POST /api/me/community-giveaways/[id]/join
 */
export async function POST(
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

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip')?.trim() ||
      'unknown'
    const wallet = session.wallet.trim()
    const ipRl = rateLimit(`community-gw-join:ip:${ip}`, 40, 60_000)
    if (!ipRl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const wRl = rateLimit(`community-gw-join:wallet:${wallet}`, 20, 60_000)
    if (!wRl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const g = await getCommunityGiveawayById(id)
    if (!g) {
      return NextResponse.json({ error: 'Giveaway not found' }, { status: 404 })
    }

    const eligibility = await canJoinCommunityGiveaway(g, wallet)
    if (!eligibility.ok) {
      return NextResponse.json(
        { error: eligibility.reason },
        { status: eligibility.status ?? 400 }
      )
    }

    const existing = await getEntryForWallet(id, wallet)
    if (existing) {
      return NextResponse.json({
        success: true,
        alreadyJoined: true,
        entry: existing,
      })
    }

    const entry = await insertCommunityGiveawayEntry(id, wallet)
    return NextResponse.json({ success: true, alreadyJoined: false, entry })
  } catch (error) {
    console.error('[me/community-giveaways join]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
