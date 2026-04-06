import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { ALL_DISCORD_SLASH_COMMANDS } from '@/lib/discord-slash-command-definitions'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/admin/discord/register-commands
 * Full admin only. PUTs global slash commands to Discord (owltopia-partner tree).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const token = process.env.DISCORD_BOT_TOKEN?.trim()
    const appId = process.env.DISCORD_APPLICATION_ID?.trim()
    if (!token || !appId) {
      return NextResponse.json(
        { error: 'DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID must be set' },
        { status: 503 }
      )
    }

    const res = await fetch(
      `https://discord.com/api/v10/applications/${encodeURIComponent(appId)}/commands`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([...ALL_DISCORD_SLASH_COMMANDS]),
      }
    )

    const text = await res.text()
    if (!res.ok) {
      console.error('[register-discord-commands]', res.status, text)
      return NextResponse.json(
        { error: `Discord API error ${res.status}`, detail: text.slice(0, 500) },
        { status: 502 }
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
    return NextResponse.json({ ok: true, commands: parsed })
  } catch (e) {
    console.error('[admin/discord/register-commands]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
