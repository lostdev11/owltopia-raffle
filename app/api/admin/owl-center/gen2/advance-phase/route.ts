import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { advanceGen2PhaseIfScheduled } from '@/lib/owl-center/gen2-phase-advance'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/** POST — manually run Gen2 scheduled phase advance (same logic as cron). */
export async function POST(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-gen2-advance:${ip}`, 30, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const result = await advanceGen2PhaseIfScheduled()
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }
    return NextResponse.json(result)
  } catch (e) {
    console.error('gen2 advance-phase', e)
    return NextResponse.json({ error: 'advance_failed' }, { status: 500 })
  }
}
