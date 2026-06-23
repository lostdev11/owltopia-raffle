import { NextRequest, NextResponse } from 'next/server'

import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import { getGen2MilestoneById } from '@/lib/db/gen2-mint-milestones'
import { requireGen2MilestoneManager } from '@/lib/owl-center/gen2-milestones/auth'
import { verifyGen2MilestoneDepositInternal } from '@/lib/owl-center/gen2-milestones/verify-deposit'
import { normalizeDepositTxSignatureInput } from '@/lib/raffles/verify-prize-deposit-client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/owl-center/gen2/milestones/[milestoneId]/verify-deposit
 * Body: { deposit_tx } — verify the funder's escrow deposit covering this prize.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  const launch = await getOwlCenterLaunchBySlugAdmin('gen2')
  if (!launch) {
    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  }

  const session = await requireGen2MilestoneManager(request, launch)
  if (session instanceof NextResponse) return session

  const params = await context.params
  const milestoneId = typeof params.milestoneId === 'string' ? params.milestoneId : ''
  if (!milestoneId) {
    return NextResponse.json({ error: 'Invalid milestone id' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const depositTx =
    typeof body.deposit_tx === 'string' ? normalizeDepositTxSignatureInput(body.deposit_tx) : ''
  if (!depositTx) {
    return NextResponse.json({ error: 'deposit_tx is required' }, { status: 400 })
  }

  const milestone = await getGen2MilestoneById(milestoneId)
  if (!milestone || milestone.launch_id !== launch.id) {
    return NextResponse.json({ error: 'Milestone not found' }, { status: 404 })
  }

  const result = await verifyGen2MilestoneDepositInternal({
    milestoneId,
    depositTx,
    funderWallet: session.wallet,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.httpStatus ?? 400 })
  }

  return NextResponse.json({ ok: true, depositVerifiedAt: result.depositVerifiedAt })
}
