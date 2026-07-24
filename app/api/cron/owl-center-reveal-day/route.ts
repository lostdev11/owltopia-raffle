import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronBearer } from '@/lib/cron-auth'

import { runRevealDayWorkerTick } from '@/lib/owl-center/reveal-worker'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/owl-center-reveal-day
 * Runs scheduled Reveal Day bulk on-chain metadata updates.
 */
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronBearer(request)
  if (cronAuth) return cronAuth

  try {
    const result = await runRevealDayWorkerTick()
    return NextResponse.json(result)
  } catch (e) {
    console.error('owl-center-reveal-day cron', e)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
