import { NextRequest, NextResponse } from 'next/server'
import { getRaffles } from '@/lib/db/raffles'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import {
  buildDailyRaidRaffleItems,
  buildSuggestedDiscordRaidMessage,
  DAILY_RAID_MAX_RAFFLES,
} from '@/lib/raffles/daily-raid-batch'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/daily-raid
 * Up to 5 live raffles ending today or tomorrow (UTC), with Owltopia X share copy.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`admin-daily-raid:${ip}:${session.wallet}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Try again in a minute.' },
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

    const nowMs = Date.now()
    const raffles = buildDailyRaidRaffleItems(allRaffles ?? [], nowMs)

    return NextResponse.json({
      timezone: 'UTC',
      maxRaffles: DAILY_RAID_MAX_RAFFLES,
      count: raffles.length,
      raffles,
      suggestedEveryoneMessage:
        raffles.length > 0
          ? buildSuggestedDiscordRaidMessage(raffles.length)
          : 'No raffles ending today or tomorrow — check back later.',
      generatedAt: new Date(nowMs).toISOString(),
    })
  } catch (error) {
    console.error('GET /api/admin/daily-raid:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
