import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById, getEntriesByRaffleId } from '@/lib/db/raffles'
import { getMilestoneById, getPriorMilestoneWinnerWallets } from '@/lib/db/raffle-milestones'
import { awardMilestoneWinner } from '@/lib/raffles/milestones/settlement'
import { requireSession } from '@/lib/auth-server'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/milestones/[milestoneId]/run-draw
 * Creator initiates platform random draw for an unlocked milestone while raffle is live.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
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
    if (!creatorWallet || !walletsEqualSolana(creatorWallet, session.wallet)) {
      return NextResponse.json({ error: 'Only the raffle creator can start this draw' }, { status: 403 })
    }

    if (raffle.status !== 'live' && raffle.status !== 'ready_to_draw') {
      return NextResponse.json({ error: 'Raffle is not active' }, { status: 400 })
    }

    if (new Date(raffle.end_time) <= new Date()) {
      return NextResponse.json({ error: 'Raffle has ended — milestone draws run at settlement' }, { status: 400 })
    }

    const milestone = await getMilestoneById(milestoneId)
    if (!milestone || milestone.raffle_id !== raffleId) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 })
    }

    if (milestone.winner_mode !== 'creator_initiated_pull') {
      return NextResponse.json({ error: 'This milestone does not use creator-initiated draws' }, { status: 400 })
    }

    if (milestone.status !== 'unlocked') {
      return NextResponse.json({ error: 'Milestone is not unlocked yet' }, { status: 400 })
    }

    if (milestone.winner_wallet) {
      return NextResponse.json({
        ok: true,
        alreadyAwarded: true,
        winnerWallet: milestone.winner_wallet,
      })
    }

    const entries = await getEntriesByRaffleId(raffleId)
    const priorWinners = await getPriorMilestoneWinnerWallets(raffleId, milestone.sort_order)
    const mainWinner = raffle.winner_wallet?.trim() ?? ''

    const awarded = await awardMilestoneWinner({
      raffle,
      milestone,
      entries,
      mainWinnerWallet: mainWinner || '__none__',
      priorMilestoneWinners: priorWinners,
      creatorTriggered: true,
    })

    if (!awarded?.winner_wallet) {
      return NextResponse.json({ error: 'Could not select a milestone winner' }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      winnerWallet: awarded.winner_wallet,
      winnerSelectedAt: awarded.winner_selected_at,
      selectionMode: awarded.winner_selection_mode,
    })
  } catch (error) {
    console.error('[milestones/run-draw]', error)
    return NextResponse.json({ error: 'Draw failed' }, { status: 500 })
  }
}
