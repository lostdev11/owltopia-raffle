import { NextRequest, NextResponse } from 'next/server'
import { processDueDiscordBroadcastSchedules } from '@/lib/discord-broadcast/run-schedules'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/discord-broadcast
 * Posts due scheduled Discord broadcast messages. Secured by CRON_SECRET.
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
