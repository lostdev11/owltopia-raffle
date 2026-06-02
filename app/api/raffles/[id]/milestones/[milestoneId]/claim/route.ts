import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import { getMilestoneById } from '@/lib/db/raffle-milestones'
import { claimMilestoneCryptoPrize } from '@/lib/raffles/milestones/payout'
import { requireSession } from '@/lib/auth-server'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/milestones/[milestoneId]/claim
 * Milestone winner claims prefunded crypto bonus from escrow.
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

    const milestone = await getMilestoneById(milestoneId)
    if (!milestone || milestone.raffle_id !== raffleId) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 })
    }

    if (!milestone.winner_wallet || !walletsEqualSolana(milestone.winner_wallet, session.wallet)) {
      return NextResponse.json({ error: 'Only the milestone winner can claim this prize' }, { status: 403 })
    }

    const result = await claimMilestoneCryptoPrize({
      milestone,
      winnerWallet: session.wallet,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      transactionSignature: result.signature,
    })
  } catch (error) {
    console.error('[milestones/claim]', error)
    return NextResponse.json({ error: 'Claim failed' }, { status: 500 })
  }
}
