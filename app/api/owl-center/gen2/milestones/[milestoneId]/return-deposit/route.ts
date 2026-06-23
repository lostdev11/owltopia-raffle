import { NextRequest, NextResponse } from 'next/server'

import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import { getGen2MilestoneById } from '@/lib/db/gen2-mint-milestones'
import { requireGen2MilestoneManager } from '@/lib/owl-center/gen2-milestones/auth'
import { returnGen2MilestoneDeposit } from '@/lib/owl-center/gen2-milestones/payout'

export const dynamic = 'force-dynamic'

/**
 * POST /api/owl-center/gen2/milestones/[milestoneId]/return-deposit
 * Return a void/unclaimed funded deposit to the wallet that funded it.
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

  const milestone = await getGen2MilestoneById(milestoneId)
  if (!milestone || milestone.launch_id !== launch.id) {
    return NextResponse.json({ error: 'Milestone not found' }, { status: 404 })
  }

  const result = await returnGen2MilestoneDeposit({ milestone })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ ok: true, transactionSignature: result.signature })
}
