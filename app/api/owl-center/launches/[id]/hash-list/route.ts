import { NextRequest, NextResponse } from 'next/server'

import { requireLaunchMintEditorSession } from '@/lib/owl-center/creator-access'
import { buildHashListPayloadForLaunch } from '@/lib/owl-center/hash-list-payload'
import { ensureSelloutMarketplacePrepIfNeeded } from '@/lib/owl-center/sellout-marketplace-prep'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/** Creator-scoped hash list for Magic Eden / Tensor submission. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-creator-hash-list:${ip}`, 30, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  const editor = await requireLaunchMintEditorSession(request, launch)
  if (editor instanceof NextResponse) return editor

  await ensureSelloutMarketplacePrepIfNeeded(launch)

  const payload = await buildHashListPayloadForLaunch(id)
  if (!payload) return jsonError('Launch not found', 404)

  return NextResponse.json(payload)
}
