import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { ALL_DISCORD_SLASH_COMMANDS } from '@/lib/discord-slash-command-definitions'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function putDiscordCommands(params: {
  token: string
  appId: string
  guildId?: string | null
}): Promise<{ ok: true; body: unknown } | { ok: false; status: number; detail: string }> {
  const path = params.guildId
    ? `https://discord.com/api/v10/applications/${encodeURIComponent(params.appId)}/guilds/${encodeURIComponent(params.guildId)}/commands`
    : `https://discord.com/api/v10/applications/${encodeURIComponent(params.appId)}/commands`

  const res = await fetch(path, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${params.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([...ALL_DISCORD_SLASH_COMMANDS]),
  })

  const text = await res.text()
  if (!res.ok) {
    console.error('[register-discord-commands]', params.guildId ? 'guild' : 'global', res.status, text)
    return { ok: false, status: res.status, detail: text.slice(0, 500) }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = text
  }
  return { ok: true, body: parsed }
}

/**
 * POST /api/admin/discord/register-commands
 * Full admin only.
 * - Always PUTs global application commands (can take up to ~1h to show in Discord).
 * - When DISCORD_GUILD_ID is set, also PUTs guild commands (appear almost immediately in that server).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const token = process.env.DISCORD_BOT_TOKEN?.trim()
    const appId = process.env.DISCORD_APPLICATION_ID?.trim()
    const guildId = process.env.DISCORD_GUILD_ID?.trim() || null
    if (!token || !appId) {
      return NextResponse.json(
        { error: 'DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID must be set' },
        { status: 503 }
      )
    }

    const globalPut = await putDiscordCommands({ token, appId })
    if (!globalPut.ok) {
      return NextResponse.json(
        { error: `Discord global commands API error ${globalPut.status}`, detail: globalPut.detail },
        { status: 502 }
      )
    }

    let guild: unknown = null
    let guildNote: string | null = null
    if (guildId) {
      const guildPut = await putDiscordCommands({ token, appId, guildId })
      if (!guildPut.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: `Global commands registered, but guild sync failed (${guildPut.status})`,
            detail: guildPut.detail,
            global: globalPut.body,
          },
          { status: 502 }
        )
      }
      guild = guildPut.body
      guildNote = 'Guild commands updated — usually visible in Discord within seconds.'
    } else {
      guildNote =
        'DISCORD_GUILD_ID unset — only global commands registered (can take up to ~1 hour). Set DISCORD_GUILD_ID for instant server updates.'
    }

    const names = ALL_DISCORD_SLASH_COMMANDS.map((c) => c.name)

    return NextResponse.json({
      ok: true,
      command_names: names,
      global: globalPut.body,
      guild,
      note: guildNote,
    })
  } catch (e) {
    console.error('[admin/discord/register-commands]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
