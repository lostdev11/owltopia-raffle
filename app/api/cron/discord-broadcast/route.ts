import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronBearer } from '@/lib/cron-auth'
import { processDueDiscordBroadcastSchedules } from '@/lib/discord-broadcast/run-schedules'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/discord-broadcast
 * Posts due scheduled Discord broadcast messages. Secured by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronBearer(request)
  if (cronAuth) return cronAuth

  try {
    const results = await processDueDiscordBroadcastSchedules()
    return NextResponse.json({
      ok: true,
      processedCount: results.length,
      results,
    })
  } catch (error) {
    console.error('Cron discord-broadcast error:', error)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
