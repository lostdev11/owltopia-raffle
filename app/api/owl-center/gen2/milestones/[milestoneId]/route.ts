import { NextRequest, NextResponse } from 'next/server'

import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import {
  deleteGen2Milestone,
  getGen2MilestoneById,
  getGen2MilestonesByLaunchId,
  updateGen2MilestoneConfig,
} from '@/lib/db/gen2-mint-milestones'
import { requireGen2MilestoneManager } from '@/lib/owl-center/gen2-milestones/auth'
import { gen2MilestoneTargetMints } from '@/lib/owl-center/gen2-milestones/target'
import { validateGen2Milestone } from '@/lib/owl-center/gen2-milestones/validation'
import { toManageGen2Milestone } from '@/lib/owl-center/gen2-milestones/serialize'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/owl-center/gen2/milestones/[milestoneId]
 *
 * - Unfunded pending/void: edit trigger, prize, and winner mode.
 * - Funded pending (armed): edit trigger + winner mode only; prize stays locked to the escrowed amount.
 * Editing a void (unfunded) milestone into a future target resets it to pending.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-gen2-ms-edit:${ip}`, 30, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

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

  const funded = !!milestone.deposit_verified_at

  if (funded) {
    // Armed milestones can still retarget / change winner selection before they fire.
    if (milestone.status !== 'pending') {
      return NextResponse.json(
        { error: 'Funded milestones can only be edited while still pending (before unlock).' },
        { status: 400 }
      )
    }
  } else if (milestone.status !== 'pending' && milestone.status !== 'void') {
    return NextResponse.json(
      { error: 'Only pending or void milestones can be edited.' },
      { status: 400 }
    )
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

  if (funded) {
    // Prize is already in escrow — ignore client prize fields and keep the stored amount/currency.
    if (
      milestone.prize_amount == null ||
      (milestone.prize_currency !== 'SOL' && milestone.prize_currency !== 'USDC')
    ) {
      return NextResponse.json({ error: 'Funded milestone is missing prize details.' }, { status: 500 })
    }
    body.prize_amount = milestone.prize_amount
    body.prize_currency = milestone.prize_currency
  }

  const existing = await getGen2MilestonesByLaunchId(launch.id)
  const existingTargets = existing
    .filter(
      (m) =>
        m.id !== milestoneId && m.status !== 'void' && m.status !== 'returned'
    )
    .map((m) => gen2MilestoneTargetMints(m, launch.total_supply))

  const result = validateGen2Milestone({
    raw: body,
    totalSupply: launch.total_supply,
    mintedCount: launch.minted_count,
    existingTargets,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  // Void milestones edited into a still-future target become pending again so they can be funded.
  const nextStatus = !funded && milestone.status === 'void' ? 'pending' : undefined

  const updated = await updateGen2MilestoneConfig(milestoneId, {
    input: result.milestone,
    triggerMintTarget: result.target,
    status: nextStatus,
    lockPrize: funded,
  })
  if (!updated) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    milestone: toManageGen2Milestone(updated, launch.total_supply),
  })
}

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
