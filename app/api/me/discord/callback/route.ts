import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getSiteBaseUrl } from '@/lib/site-config'
import {
  exchangeDiscordOAuthCode,
  fetchDiscordUserMe,
  formatDiscordDisplayName,
  verifyDiscordOAuthState,
} from '@/lib/discord-oauth'
import { linkDiscordToWallet } from '@/lib/db/wallet-profiles'

export const dynamic = 'force-dynamic'

function redirectWith(query: Record<string, string>): NextResponse {
  const base = getSiteBaseUrl()
  const u = new URL(`${base}/dashboard`)
  for (const [k, v] of Object.entries(query)) {
    u.searchParams.set(k, v)
  }
  return NextResponse.redirect(u.toString())
}

/**
 * GET /api/me/discord/callback
 * OAuth redirect target. Exchanges code, stores Discord id on wallet_profiles for the signed-in wallet.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const { searchParams } = new URL(request.url)
    const oauthErr = searchParams.get('error')
    if (oauthErr) {
      return redirectWith({ discord_error: oauthErr })
    }

    const code = searchParams.get('code')
    const state = searchParams.get('state')
    if (!code?.trim() || !state?.trim()) {
      return redirectWith({ discord_error: 'missing_params' })
    }

    if (!verifyDiscordOAuthState(state, session.wallet)) {
      return redirectWith({ discord_error: 'invalid_state' })
    }

    const token = await exchangeDiscordOAuthCode(code)
    if (!token) {
      return redirectWith({ discord_error: 'token' })
    }

    const me = await fetchDiscordUserMe(token.access_token)
    if (!me) {
      return redirectWith({ discord_error: 'profile' })
    }

    const result = await linkDiscordToWallet(session.wallet, me.id, formatDiscordDisplayName(me))
    if (!result.ok) {
      return redirectWith({
        discord_error: result.code === 'taken' ? 'discord_taken' : 'link_failed',
      })
    }

    return redirectWith({ discord_linked: '1' })
  } catch (e) {
    console.error('[me/discord/callback]', e)
    return redirectWith({ discord_error: 'link_failed' })
  }
}
