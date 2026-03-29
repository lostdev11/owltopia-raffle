import { NextRequest, NextResponse } from 'next/server'
import { getRaffles } from '@/lib/db/raffles'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import { isRaffleLiveForManualDiscordShare } from '@/lib/raffles/discord-live-share'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/live-raffles
 * Active raffles admins can promote to Discord (end time in the future, active, not terminal status).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`admin-live-raffles:${ip}:${session.wallet}`, 120, 60_000)
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
    const live = (allRaffles ?? [])
      .filter((r) => isRaffleLiveForManualDiscordShare(r, nowMs))
      .map((r) => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        endTime: r.end_time,
        status: r.status,
      }))
      .sort((a, b) => new Date(a.endTime).getTime() - new Date(b.endTime).getTime())

    return NextResponse.json({ count: live.length, raffles: live })
  } catch (error) {
    console.error('GET /api/admin/live-raffles:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
