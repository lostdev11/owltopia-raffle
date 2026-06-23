import { NextRequest, NextResponse } from 'next/server'

import { getOwlCenterLaunchBySlug, getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import {
  getGen2MilestonesByLaunchId,
  insertGen2Milestone,
} from '@/lib/db/gen2-mint-milestones'
import { validateGen2Milestone } from '@/lib/owl-center/gen2-milestones/validation'
import { gen2MilestoneTargetMints } from '@/lib/owl-center/gen2-milestones/target'
import { requireGen2MilestoneManager } from '@/lib/owl-center/gen2-milestones/auth'
import {
  toManageGen2Milestone,
  toPublicGen2Milestone,
} from '@/lib/owl-center/gen2-milestones/serialize'
import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/owl-center/gen2/milestones — public milestone ladder for the mint page.
 * `?scope=manage` returns the full list incl. unfunded drafts + deposit details
 * (requires admin/creator).
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-gen2-ms-list:${ip}`, 120, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const manage = request.nextUrl.searchParams.get('scope') === 'manage'

  const launch = manage
    ? await getOwlCenterLaunchBySlugAdmin('gen2')
    : await getOwlCenterLaunchBySlug('gen2')
  if (!launch) {
    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  }

  if (manage) {
    const session = await requireGen2MilestoneManager(request, launch)
    if (session instanceof NextResponse) return session
    const milestones = await getGen2MilestonesByLaunchId(launch.id)
    return NextResponse.json({
      minted_count: launch.minted_count,
      total_supply: launch.total_supply,
      escrow_wallet: getFundsEscrowPublicKey(),
      milestones: milestones.map((m) => toManageGen2Milestone(m, launch.total_supply)),
    })
  }

  const milestones = await getGen2MilestonesByLaunchId(launch.id)
  // Public sees only armed milestones: funded and not voided/returned.
  const visible = milestones.filter(
    (m) => m.deposit_verified_at && m.status !== 'void' && m.status !== 'returned'
  )

  return NextResponse.json({
    minted_count: launch.minted_count,
    total_supply: launch.total_supply,
    milestones: visible.map((m) => toPublicGen2Milestone(m, launch.total_supply)),
  })
}

/** POST /api/owl-center/gen2/milestones — admin/creator adds a milestone (pre-launch or mid-mint). */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-gen2-ms-add:${ip}`, 30, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const launch = await getOwlCenterLaunchBySlugAdmin('gen2')
  if (!launch) {
    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  }

  const session = await requireGen2MilestoneManager(request, launch)
  if (session instanceof NextResponse) return session

  const escrow = getFundsEscrowPublicKey()
  if (!escrow) {
    return NextResponse.json({ error: 'Funds escrow is not configured.' }, { status: 503 })
  }

  const body = await request.json().catch(() => ({}))

  const existing = await getGen2MilestonesByLaunchId(launch.id)
  const existingTargets = existing
    .filter((m) => m.status !== 'void' && m.status !== 'returned')
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

  const milestone = await insertGen2Milestone({
    launchId: launch.id,
    input: result.milestone,
    triggerMintTarget: result.target,
    fundedByWallet: session.wallet,
  })

  return NextResponse.json({
    ok: true,
    milestone: toPublicGen2Milestone(milestone, launch.total_supply),
    funding: {
      escrow_wallet: escrow,
      amount: result.milestone.prize_amount,
      currency: result.milestone.prize_currency,
    },
  })
}
