import { NextRequest, NextResponse } from 'next/server'

import { runRevealDayWorkerTick } from '@/lib/owl-center/reveal-worker'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/owl-center-reveal-day
 * Runs scheduled Reveal Day bulk on-chain metadata updates.
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
    const result = await runRevealDayWorkerTick()
    return NextResponse.json(result)
  } catch (e) {
    console.error('owl-center-reveal-day cron', e)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
