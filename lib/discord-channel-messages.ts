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

/** Admin UI hint: last 4 digits of configured channel ids (not secret; helps verify env). */
export function getDiscordBroadcastChannelConfig(): {
  public: { configured: boolean; idSuffix: string | null }
  holder: { configured: boolean; idSuffix: string | null }
  sameChannel: boolean
} {
  const publicId = getDiscordPublicChannelId()
  const holderId = getDiscordHolderChannelId()
  return {
    public: {
      configured: Boolean(publicId),
      idSuffix: publicId ? publicId.slice(-4) : null,
    },
    holder: {
      configured: Boolean(holderId),
      idSuffix: holderId ? holderId.slice(-4) : null,
    },
    sameChannel: Boolean(publicId && holderId && publicId === holderId),
  }
}

export type DiscordChannelMeta = {
  idSuffix: string
  name: string | null
}

/** Resolve Discord #channel names for admin verification (requires bot token). */
export async function fetchDiscordChannelMeta(
  channelId: string
): Promise<DiscordChannelMeta | null> {
  const token = getDiscordBotToken()
  const cid = channelId.trim()
  if (!token || !cid) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${DISCORD_API}/channels/${cid}`, {
      headers: { Authorization: `Bot ${token}` },
      signal: controller.signal,
    })
    if (!res.ok) return { idSuffix: cid.slice(-4), name: null }
    const json = (await res.json()) as { name?: string }
    const name = typeof json.name === 'string' ? json.name : null
    return { idSuffix: cid.slice(-4), name }
  } catch {
    return { idSuffix: cid.slice(-4), name: null }
  } finally {
    clearTimeout(timer)
  }
}

function channelNamesLookSwapped(
  publicName: string | null,
  holderName: string | null
): boolean {
  if (!publicName || !holderName) return false
  const pub = publicName.toLowerCase()
  const holder = holderName.toLowerCase()
  const publicEnvPointsAtOwl = pub.includes('owl') && !pub.includes('public')
  const holderEnvPointsAtPublic = holder.includes('public')
  return publicEnvPointsAtOwl && holderEnvPointsAtPublic
}

export async function getDiscordBroadcastChannelConfigDetailed(): Promise<{
  public: { configured: boolean; idSuffix: string | null; name: string | null }
  holder: { configured: boolean; idSuffix: string | null; name: string | null }
  sameChannel: boolean
  idsLikelySwapped: boolean
}> {
  const base = getDiscordBroadcastChannelConfig()
  const publicId = getDiscordPublicChannelId()
  const holderId = getDiscordHolderChannelId()

  const [publicMeta, holderMeta] = await Promise.all([
    publicId ? fetchDiscordChannelMeta(publicId) : Promise.resolve(null),
    holderId ? fetchDiscordChannelMeta(holderId) : Promise.resolve(null),
  ])

  const publicName = publicMeta?.name ?? null
  const holderName = holderMeta?.name ?? null

  return {
    public: {
      configured: base.public.configured,
      idSuffix: base.public.idSuffix,
      name: publicName,
    },
    holder: {
      configured: base.holder.configured,
      idSuffix: base.holder.idSuffix,
      name: holderName,
    },
    sameChannel: base.sameChannel,
    idsLikelySwapped: channelNamesLookSwapped(publicName, holderName),
  }
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
