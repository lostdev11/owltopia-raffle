import { NextRequest, NextResponse } from 'next/server'

import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import { deleteGen2Milestone, getGen2MilestoneById } from '@/lib/db/gen2-mint-milestones'
import { requireGen2MilestoneManager } from '@/lib/owl-center/gen2-milestones/auth'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/owl-center/gen2/milestones/[milestoneId]
 * Remove a milestone that has not been funded yet (pending + no verified deposit).
 * Funded milestones must be returned via the return-deposit route instead.
 */
export async function DELETE(
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

  if (milestone.deposit_verified_at) {
    return NextResponse.json(
      { error: 'This milestone is funded — return the deposit before removing it.' },
      { status: 400 }
    )
  }
  if (milestone.status !== 'pending' && milestone.status !== 'void') {
    return NextResponse.json({ error: 'Only pending or void milestones can be removed.' }, { status: 400 })
  }

  const ok = await deleteGen2Milestone(milestoneId)
  if (!ok) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
