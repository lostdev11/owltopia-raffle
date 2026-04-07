import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { generateDiscordOAuthState, getDiscordOAuthAuthorizeUrl } from '@/lib/discord-oauth'
import { getSiteBaseUrl } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

/**
 * GET /api/me/discord/link
 * Redirects to Discord OAuth (identify). Requires wallet session.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const url = getDiscordOAuthAuthorizeUrl(generateDiscordOAuthState(session.wallet))
    if (!url) {
      const base = getSiteBaseUrl()
      return NextResponse.redirect(`${base}/dashboard?discord_error=not_configured`)
    }
    return NextResponse.redirect(url)
  } catch (e) {
    console.error('[me/discord/link]', e)
    return NextResponse.json({ error: 'Failed to start Discord link' }, { status: 500 })
  }
}
