import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import {
  adminForfeitOwlCenterPlatformFeeRebates,
  adminReleaseOwlCenterPlatformFeeRebates,
  listOwlCenterPlatformFeeRebatesForLaunch,
  summarizeOwlCenterPlatformFeeRebates,
  unlockOwlCenterPlatformFeeRebatesAfterMintEnd,
} from '@/lib/db/owl-center-platform-fee-rebates'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-fee-rebates-get:${ip}`, 60, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  const [summary, rows] = await Promise.all([
    summarizeOwlCenterPlatformFeeRebates(id),
    listOwlCenterPlatformFeeRebatesForLaunch(id, 100),
  ])

  return NextResponse.json({
    launch: {
      id: launch.id,
      slug: launch.slug,
      name: launch.name,
      platform_fee_rebate_bps: launch.platform_fee_rebate_bps,
      platform_fee_rebate_wallet: launch.platform_fee_rebate_wallet,
      active_phase: launch.active_phase,
      status: launch.status,
      minted_count: launch.minted_count,
      total_supply: launch.total_supply,
    },
    summary,
    rows,
  })
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-fee-rebates-post:${ip}`, 30, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const action = String(body.action ?? '').trim().toLowerCase()
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : null
  const adminWallet = session.wallet

  if (action === 'mark_releasable' || action === 'unlock') {
    const result = await unlockOwlCenterPlatformFeeRebatesAfterMintEnd(launch, {
      attemptPayout: body.attempt_payout !== false,
    })
    if (!result.ok) return jsonError(result.error, 400)
    return NextResponse.json(result)
  }

  if (action === 'release') {
    const result = await adminReleaseOwlCenterPlatformFeeRebates({
      launch,
      adminWallet,
      includeLocked: body.include_locked === true,
      notes,
    })
    if (!result.ok) return jsonError(result.error, 400)
    return NextResponse.json(result)
  }

  if (action === 'forfeit') {
    const result = await adminForfeitOwlCenterPlatformFeeRebates({
      launchId: launch.id,
      adminWallet,
      includeReleasable: body.include_releasable !== false,
      notes,
    })
    if (!result.ok) return jsonError(result.error, 400)
    return NextResponse.json(result)
  }

  return jsonError('Invalid action — use release | forfeit | mark_releasable', 400)
}
