import { NextRequest, NextResponse } from 'next/server'

import { advanceGen2PhaseIfScheduled } from '@/lib/owl-center/gen2-phase-advance'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/cron/gen2-phase-advance
 * Vercel Cron: advances Owltopia Gen2 `active_phase` when per-phase schedule times pass.
 * Secured by CRON_SECRET (Bearer token).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('CRON_SECRET is not set')
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'server error' }, { status: 401 })
  }

  try {
    const result = await advanceGen2PhaseIfScheduled()
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
    }
    return NextResponse.json(result)
  } catch (e) {
    console.error('gen2-phase-advance cron', e)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
