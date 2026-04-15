import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import {
  generateDiscordOAuthState,
  getDiscordOAuthAuthorizeUrl,
  getDiscordOAuthRedirectUriFromRequest,
  getRequestOriginForOAuth,
} from '@/lib/discord-oauth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/me/discord/link
 * Redirects to Discord OAuth (identify). Requires wallet session.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) {
      const base = getRequestOriginForOAuth(request)
      return NextResponse.redirect(`${base}/dashboard?discord_error=sign_in_required`)
    }

    const redirectUri = getDiscordOAuthRedirectUriFromRequest(request)
    const url = getDiscordOAuthAuthorizeUrl(generateDiscordOAuthState(session.wallet), redirectUri)
    if (!url) {
      const base = getRequestOriginForOAuth(request)
      return NextResponse.redirect(`${base}/dashboard?discord_error=not_configured`)
    }
    return NextResponse.redirect(url)
  } catch (e) {
    console.error('[me/discord/link]', e)
    return NextResponse.json({ error: 'Failed to start Discord link' }, { status: 500 })
  }
}
