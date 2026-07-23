import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import {
  freezeStatusPayload,
  startGen2ThawManual,
  unlockGen2FreezeEscrowAdmin,
} from '@/lib/owl-center/gen2-thaw-ops'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/admin/owl-center/gen2/thaw
 * body: { action: 'start' | 'status' | 'unlock' }
 */
export async function POST(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-gen2-thaw:${ip}`, 30, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: { action?: string }
  try {
    body = (await request.json()) as { action?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = (body.action ?? 'status').trim().toLowerCase()

  if (action === 'status') {
    const launch = await getOwlCenterLaunchBySlugAdmin('gen2')
    if (!launch) return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
    return NextResponse.json({ ok: true, ...freezeStatusPayload(launch) })
  }

  if (action === 'start') {
    const res = await startGen2ThawManual()
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
    return NextResponse.json({ ok: true, ...freezeStatusPayload(res.launch) })
  }

  if (action === 'unlock') {
    const res = await unlockGen2FreezeEscrowAdmin()
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
    return NextResponse.json({
      ok: true,
      signature: res.signature,
      ...freezeStatusPayload(res.launch),
    })
  }

  return NextResponse.json({ error: 'Invalid action — use start, status, or unlock' }, { status: 400 })
}
