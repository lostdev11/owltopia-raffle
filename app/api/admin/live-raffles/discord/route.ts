import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import { isRaffleLiveForManualDiscordShare } from '@/lib/raffles/discord-live-share'
import { pushLiveRaffleToDiscord } from '@/lib/discord-raffle-webhooks'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { isRaffleIdUuid } from '@/lib/raffle-id'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/live-raffles/discord
 * Body: { raffleId: string }. Posts one live raffle embed to DISCORD_WEBHOOK_LIVE_RAFFLES.
 * Full-admin session + rate limit; webhook URL must be official Discord HTTPS only (see lib/discord-webhook-url.ts).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`discord-live-push:${ip}:${session.wallet}`, 24, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many Discord posts. Try again in a minute.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const body = await request.json().catch(() => ({}))
    const raffleId = typeof body.raffleId === 'string' ? body.raffleId.trim() : ''
    if (!raffleId) {
      return NextResponse.json({ error: 'raffleId is required' }, { status: 400 })
    }
    if (!isRaffleIdUuid(raffleId)) {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    if (!isRaffleLiveForManualDiscordShare(raffle)) {
      return NextResponse.json(
        {
          error:
            'This raffle is not eligible for a live Discord post (inactive, ended, or closed status).',
        },
        { status: 400 }
      )
    }

    const result = await pushLiveRaffleToDiscord(raffle)
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Discord post failed' }, { status: 502 })
    }

    return NextResponse.json({ success: true, raffleId: raffle.id })
  } catch (error) {
    console.error('POST /api/admin/live-raffles/discord:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
