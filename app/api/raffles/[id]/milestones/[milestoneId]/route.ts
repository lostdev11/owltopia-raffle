import { NextRequest, NextResponse } from 'next/server'

import { requireSession } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'
import { getRaffleById } from '@/lib/db/raffles'
import {
  getMilestoneById,
  updateRaffleMilestoneWinnerMode,
} from '@/lib/db/raffle-milestones'
import type { RaffleMilestoneWinnerMode } from '@/lib/types'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

const WINNER_MODES: ReadonlySet<RaffleMilestoneWinnerMode> = new Set([
  'random',
  'top_buyer',
  'creator_initiated_pull',
])

/**
 * PATCH /api/raffles/[id]/milestones/[milestoneId]
 * Creator or admin can change winner selection (random / top buyer / creator draw)
 * while the milestone has not yet awarded a winner. Prize stays unchanged.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const ip = getClientIp(request)
    if (!rateLimit(`raffle-ms-edit:${ip}`, 40, 60_000).allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const raffleId = params.id
    const milestoneId = params.milestoneId
    if (typeof raffleId !== 'string' || typeof milestoneId !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
    const isCreator =
      !!creatorWallet && walletsEqualSolana(creatorWallet, session.wallet)
    const isAdmin = (await getAdminRole(session.wallet)) !== null
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const milestone = await getMilestoneById(milestoneId)
    if (!milestone || milestone.raffle_id !== raffleId) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 })
    }

    if (milestone.winner_wallet) {
      return NextResponse.json(
        { error: 'This milestone already has a winner — winner mode cannot be changed.' },
        { status: 400 }
      )
    }

    if (
      milestone.status !== 'pending' &&
      milestone.status !== 'unlocked'
    ) {
      return NextResponse.json(
        { error: 'Only pending or unlocked milestones can change winner mode.' },
        { status: 400 }
      )
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const winnerMode = body.winner_mode
    if (typeof winnerMode !== 'string' || !WINNER_MODES.has(winnerMode as RaffleMilestoneWinnerMode)) {
      return NextResponse.json(
        {
          error:
            'Invalid winner_mode. Use random, top_buyer, or creator_initiated_pull.',
        },
        { status: 400 }
      )
    }

    if (winnerMode === milestone.winner_mode) {
      return NextResponse.json({ ok: true, milestone })
    }

    const updated = await updateRaffleMilestoneWinnerMode(
      milestoneId,
      winnerMode as RaffleMilestoneWinnerMode
    )
    if (!updated) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, milestone: updated })
  } catch (error) {
    console.error('[milestones/PATCH]', error)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}
