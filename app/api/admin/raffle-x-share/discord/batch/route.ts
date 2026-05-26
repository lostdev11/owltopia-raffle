import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import { pushAdminXTweetMirrorsBatchToDiscord } from '@/lib/discord-raffle-webhooks'
import { MAX_X_POST_TWEET_MIRRORS } from '@/lib/raffles/x-tweet-discord-mirror'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/raffle-x-share/discord/batch
 * Body: { tweetUrls?: string[], tweetUrlsText?: string } — up to 5 @Owltopia_sol posts.
 * Each becomes its own #x-post message with a fixupx embed (@raid role ping).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`discord-x-post-batch:${ip}:${session.wallet}`, 12, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many Discord posts. Try again in a minute.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const body = await request.json().catch(() => ({}))
    const fromArray = Array.isArray(body.tweetUrls)
      ? body.tweetUrls.filter((u: unknown) => typeof u === 'string').map((u: string) => u.trim())
      : []
    const textBlock = typeof body.tweetUrlsText === 'string' ? body.tweetUrlsText.trim() : ''
    const combined = [...fromArray, ...(textBlock ? [textBlock] : [])]

    if (combined.length === 0) {
      return NextResponse.json(
        {
          error: `Provide tweetUrls or tweetUrlsText (up to ${MAX_X_POST_TWEET_MIRRORS} x.com/Owltopia_sol/status/… links).`,
        },
        { status: 400 }
      )
    }

    const result = await pushAdminXTweetMirrorsBatchToDiscord(combined)
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Discord post failed' }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      posted: result.posted,
      contents: result.contents,
      errors: result.errors.length > 0 ? result.errors : undefined,
    })
  } catch (error) {
    console.error('POST /api/admin/raffle-x-share/discord/batch:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
