import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getDiscordBotInviteUrl } from '@/lib/discord-bot-invite'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/discord/bot-invite — full admin; returns the canonical bot invite URL.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const inviteUrl = getDiscordBotInviteUrl()
    if (!inviteUrl) {
      return NextResponse.json(
        {
          error:
            'Bot invite not configured. Set DISCORD_BOT_INVITE_URL or DISCORD_APPLICATION_ID on the server.',
        },
        { status: 503 }
      )
    }
    return NextResponse.json({ inviteUrl })
  } catch (error) {
    console.error('[admin/discord/bot-invite GET]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
