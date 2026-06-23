import { NextRequest, NextResponse } from 'next/server'

import { requireSession } from '@/lib/auth-server'
import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { getGen2MilestoneById } from '@/lib/db/gen2-mint-milestones'
import { claimGen2MilestonePrize } from '@/lib/owl-center/gen2-milestones/payout'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

/**
 * POST /api/owl-center/gen2/milestones/[milestoneId]/claim
 * Milestone winner claims the prefunded crypto bonus from escrow.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const launch = await getOwlCenterLaunchBySlug('gen2')
    if (!launch) {
      return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
    }

    const params = await context.params
    const milestoneId = typeof params.milestoneId === 'string' ? params.milestoneId : ''
    if (!milestoneId) {
      return NextResponse.json({ error: 'Invalid milestone id' }, { status: 400 })
    }

    const milestone = await getGen2MilestoneById(milestoneId)
    if (!milestone || milestone.launch_id !== launch.id) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 })
    }

    if (!milestone.winner_wallet || !walletsEqualSolana(milestone.winner_wallet, session.wallet)) {
      return NextResponse.json({ error: 'Only the milestone winner can claim this prize' }, { status: 403 })
    }

    const result = await claimGen2MilestonePrize({ milestone, winnerWallet: session.wallet })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ ok: true, transactionSignature: result.signature })
  } catch (error) {
    console.error('[gen2 milestone claim]', error)
    return NextResponse.json({ error: 'Claim failed' }, { status: 500 })
  }
}
