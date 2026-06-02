/**
 * Post plain messages to Discord channels via bot token (server-side only).
 */
const DISCORD_API = 'https://discord.com/api/v10'
const MAX_CONTENT_LENGTH = 2000
const REQUEST_TIMEOUT_MS = 10_000

export type DiscordChannelPostResult =
  | { ok: true; messageId: string }
  | { ok: false; code: 'not_configured' | 'forbidden' | 'api_error'; message: string }

function getDiscordBotToken(): string | null {
  return process.env.DISCORD_BOT_TOKEN?.trim() || null
}

export function getDiscordPublicChannelId(): string | null {
  return process.env.DISCORD_CHANNEL_PUBLIC?.trim() || null
}

export function getDiscordHolderChannelId(): string | null {
  return process.env.DISCORD_CHANNEL_HOLDER?.trim() || null
}

export function isDiscordBroadcastConfigured(): boolean {
  const token = getDiscordBotToken()
  const publicCh = getDiscordPublicChannelId()
  const holderCh = getDiscordHolderChannelId()
  return Boolean(token && (publicCh || holderCh))
}

function truncateContent(content: string): string {
  const trimmed = content.trim()
  if (trimmed.length <= MAX_CONTENT_LENGTH) return trimmed
  return `${trimmed.slice(0, MAX_CONTENT_LENGTH - 3)}...`
}

/**
 * POST /channels/{channel.id}/messages — no @mentions allowed.
 */
export async function postDiscordChannelMessage(
  channelId: string,
  content: string
): Promise<DiscordChannelPostResult> {
  const token = getDiscordBotToken()
  if (!token) {
    return { ok: false, code: 'not_configured', message: 'DISCORD_BOT_TOKEN is not set.' }
  }

  const cid = channelId.trim()
  if (!cid) {
    return { ok: false, code: 'api_error', message: 'Invalid channel id.' }
  }

  const body = truncateContent(content)
  if (!body) {
    return { ok: false, code: 'api_error', message: 'Message body is empty.' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(`${DISCORD_API}/channels/${cid}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: body,
        allowed_mentions: { parse: [] },
      }),
      signal: controller.signal,
    })

    const text = await res.text().catch(() => '')
    if (res.ok) {
      let messageId = ''
      try {
        const json = JSON.parse(text) as { id?: string }
        messageId = json.id ?? ''
      } catch {
        messageId = ''
      }
      return { ok: true, messageId }
    }

    if (res.status === 403) {
      return {
        ok: false,
        code: 'forbidden',
        message:
          'Bot cannot post in this channel. Check Send Messages permission and channel access.',
      }
    }

    console.error('[discord-channel-messages] post failed', res.status, text.slice(0, 400))
    return {
      ok: false,
      code: 'api_error',
      message: `Discord API error (${res.status}).`,
    }
  } catch (err) {
    console.error('[discord-channel-messages] post error', err)
    return { ok: false, code: 'api_error', message: 'Could not reach Discord.' }
  } finally {
    clearTimeout(timer)
  }
}

export type BroadcastChannelTarget = 'public' | 'holder'

export async function postDiscordBroadcastMessage(
  content: string,
  targets: BroadcastChannelTarget[]
): Promise<{ results: Array<{ target: BroadcastChannelTarget; result: DiscordChannelPostResult }> }> {
  const unique = [...new Set(targets)]
  const results: Array<{ target: BroadcastChannelTarget; result: DiscordChannelPostResult }> = []

  for (const target of unique) {
    const channelId =
      target === 'public' ? getDiscordPublicChannelId() : getDiscordHolderChannelId()
    if (!channelId) {
      results.push({
        target,
        result: {
          ok: false,
          code: 'not_configured',
          message:
            target === 'public'
              ? 'DISCORD_CHANNEL_PUBLIC is not set.'
              : 'DISCORD_CHANNEL_HOLDER is not set.',
        },
      })
      continue
    }
    const result = await postDiscordChannelMessage(channelId, content)
    results.push({ target, result })
  }

  return { results }
}
