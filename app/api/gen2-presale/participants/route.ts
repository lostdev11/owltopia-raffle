import { NextRequest, NextResponse } from 'next/server'

import { listGen2PresaleParticipants } from '@/lib/gen2-presale/db'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 150
const MAX_LIMIT = 500

export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`gen2-presale-participants:${ip}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const raw = request.nextUrl.searchParams.get('limit')
    const n = raw != null ? Math.floor(Number(raw)) : DEFAULT_LIMIT
    const limit = Number.isFinite(n) ? Math.min(MAX_LIMIT, Math.max(1, n)) : DEFAULT_LIMIT

    const participants = await listGen2PresaleParticipants(limit)
    return NextResponse.json({
      participants,
      count: participants.length,
    })
  } catch (error) {
    console.error('gen2-presale participants:', error)
    return NextResponse.json({ error: 'Failed to load participants' }, { status: 500 })
  }
}
