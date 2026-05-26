import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import { isRaffleLiveForManualDiscordShare } from '@/lib/raffles/discord-live-share'
import { pushAdminRaffleXShareToDiscord } from '@/lib/discord-raffle-webhooks'
import { parseXTweetStatusUrl } from '@/lib/raffles/x-tweet-discord-mirror'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { isRaffleIdUuid } from '@/lib/raffle-id'

export const dynamic = 'force-dynamic'

const RAFFLE_DEDUPE_MS = 2 * 60 * 60 * 1000 // 2h — same raffle not mirrored twice per admin

/**
 * POST /api/admin/raffle-x-share/discord
 * Body: { raffleId: string, tweetUrl: string }.
 * Mirrors an @Owltopia_sol tweet into DISCORD_WEBHOOK_X_POSTS (#x-post) with a fixupx embed.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`discord-x-post:${ip}:${session.wallet}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many Discord posts. Try again in a minute.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const body = await request.json().catch(() => ({}))
    const raffleId = typeof body.raffleId === 'string' ? body.raffleId.trim() : ''
    const tweetUrl = typeof body.tweetUrl === 'string' ? body.tweetUrl.trim() : ''
    if (!raffleId) {
      return NextResponse.json({ error: 'raffleId is required' }, { status: 400 })
    }
    if (!tweetUrl) {
      return NextResponse.json(
        { error: 'tweetUrl is required — paste the @Owltopia_sol post link after you publish on X.' },
        { status: 400 }
      )
    }
    if (!parseXTweetStatusUrl(tweetUrl)) {
      return NextResponse.json(
        {
          error:
            'Invalid tweetUrl. Use https://x.com/Owltopia_sol/status/… (or fixupx.com / twitter.com equivalent).',
        },
        { status: 400 }
      )
    }
    if (!isRaffleIdUuid(raffleId)) {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const dedupe = rateLimit(`discord-x-post-raffle:${session.wallet}:${raffleId}`, 1, RAFFLE_DEDUPE_MS)
    if (!dedupe.allowed) {
      return NextResponse.json(
        {
          error: 'This raffle was already mirrored to #x-post recently. Try again later or share a different raffle.',
        },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((dedupe.resetAt - Date.now()) / 1000)) } }
      )
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    if (!isRaffleLiveForManualDiscordShare(raffle)) {
      return NextResponse.json(
        {
          error:
            'This raffle is not eligible for an X-post mirror (inactive, ended, or closed status).',
        },
        { status: 400 }
      )
    }

    const result = await pushAdminRaffleXShareToDiscord(tweetUrl)
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Discord post failed' }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      raffleId: raffle.id,
      discordContent: result.discordContent,
    })
  } catch (error) {
    console.error('POST /api/admin/raffle-x-share/discord:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
