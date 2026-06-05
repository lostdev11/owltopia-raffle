import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import { getMilestonesByRaffleId } from '@/lib/db/raffle-milestones'
import { returnMilestoneDepositToCreator } from '@/lib/raffles/milestones/payout'
import { requireSession } from '@/lib/auth-server'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/claim-milestone-return
 * Creator claims prefunded milestone escrow back when raffle failed (min not met).
 * Body: { milestone_id }
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
    if (typeof raffleId !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const milestoneId = typeof body.milestone_id === 'string' ? body.milestone_id.trim() : ''
    if (!milestoneId) {
      return NextResponse.json({ error: 'milestone_id is required' }, { status: 400 })
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
    if (!creatorWallet || !walletsEqualSolana(creatorWallet, session.wallet)) {
      return NextResponse.json({ error: 'Only the raffle creator can claim milestone returns' }, { status: 403 })
    }

    if (raffle.status !== 'failed_refund_available' && raffle.status !== 'cancelled') {
      return NextResponse.json(
        { error: 'Milestone returns are only available for failed or cancelled raffles' },
        { status: 400 }
      )
    }

    const milestones = await getMilestonesByRaffleId(raffleId)
    const milestone = milestones.find((m) => m.id === milestoneId)
    if (!milestone) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 })
    }

    const result = await returnMilestoneDepositToCreator({ milestone, raffle })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      transactionSignature: result.signature,
    })
  } catch (error) {
    console.error('[claim-milestone-return]', error)
    return NextResponse.json({ error: 'Return failed' }, { status: 500 })
  }
}
