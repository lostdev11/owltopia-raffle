import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { pushDiscordRaidPingToXPosts } from '@/lib/discord-raffle-webhooks'
import { DAILY_RAID_MAX_RAFFLES } from '@/lib/raffles/daily-raid-batch'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/daily-raid/raid-ping/discord
 * Posts one @raid ping to DISCORD_WEBHOOK_X_POSTS (not @everyone).
 * Body: { count?: number } — number of tweets to raid (1–5, default 1).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`admin-daily-raid-ping:${ip}:${session.wallet}`, 12, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Try again in a minute.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const body = await request.json().catch(() => ({}))
    let count = typeof body.count === 'number' ? Math.floor(body.count) : 1
    if (!Number.isFinite(count) || count < 1) count = 1
    if (count > DAILY_RAID_MAX_RAFFLES) count = DAILY_RAID_MAX_RAFFLES

    const result = await pushDiscordRaidPingToXPosts(count)
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Discord post failed' }, { status: 502 })
    }

    return NextResponse.json({ ok: true, content: result.content, count })
  } catch (error) {
    console.error('POST /api/admin/daily-raid/raid-ping/discord:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
