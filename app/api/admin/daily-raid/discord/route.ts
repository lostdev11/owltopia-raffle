import { NextRequest, NextResponse } from 'next/server'
import { getRaffles } from '@/lib/db/raffles'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import { selectRafflesForDailyRaid } from '@/lib/raffles/daily-raid-batch'
import { pushDailyRaidBundleToDiscord } from '@/lib/discord-raffle-webhooks'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/daily-raid/discord
 * Posts one bundle message to DISCORD_WEBHOOK_X_POSTS for raffles ending today/tomorrow (UTC, max 5).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`admin-daily-raid-discord:${ip}:${session.wallet}`, 12, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many Discord posts. Try again in a minute.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const { data: allRaffles, error } = await getRaffles(false, { includeDraft: true })
    if (error) {
      return NextResponse.json(
        { error: error.message || 'Could not load raffles' },
        { status: 502 }
      )
    }

    const batch = selectRafflesForDailyRaid(allRaffles ?? [])
    if (batch.length === 0) {
      return NextResponse.json(
        { error: 'No live raffles ending today or tomorrow (UTC).' },
        { status: 400 }
      )
    }

    const result = await pushDailyRaidBundleToDiscord(batch)
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Discord post failed' }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      count: batch.length,
      raffleIds: batch.map((r) => r.id),
    })
  } catch (error) {
    console.error('POST /api/admin/daily-raid/discord:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
