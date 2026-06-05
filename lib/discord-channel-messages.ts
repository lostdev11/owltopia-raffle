/**
 * Post plain messages to Discord channels via bot token (server-side only).
 */
const DISCORD_API = 'https://discord.com/api/v10'
const MAX_CONTENT_LENGTH = 2000
const REQUEST_TIMEOUT_MS = 25_000
const WORKER_REQUEST_TIMEOUT_MS = 12_000
const MAX_POST_ATTEMPTS = 3

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getDiscordBroadcastWorkerConfig(): { url: string; secret: string } | null {
  const url = process.env.DISCORD_BROADCAST_WORKER_URL?.trim().replace(/\/$/, '') ?? ''
  const secret = process.env.DISCORD_BROADCAST_WORKER_SECRET?.trim() ?? ''
  if (!url || !secret) return null
  return { url, secret }
}

async function postDiscordChannelMessageViaWorker(
  channelId: string,
  content: string
): Promise<DiscordChannelPostResult | null> {
  const worker = getDiscordBroadcastWorkerConfig()
  if (!worker) return null

  const body = truncateContent(content)
  if (!body) return { ok: false, code: 'api_error', message: 'Message body is empty.' }

  try {
    const res = await fetch(`${worker.url}/broadcast`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${worker.secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channelId, content: body }),
      signal: AbortSignal.timeout(WORKER_REQUEST_TIMEOUT_MS),
    })

    const text = await res.text().catch(() => '')
    if (res.ok) {
      let messageId = ''
      try {
        const json = JSON.parse(text) as { messageId?: string }
        messageId = json.messageId ?? ''
      } catch {
        messageId = ''
      }
      return { ok: true, messageId }
    }

    if (res.status === 401 || res.status === 503) {
      console.warn('[discord-channel-messages] worker unavailable', res.status, text.slice(0, 200))
      return null
    }

    let message = `Broadcast worker error (${res.status}).`
    try {
      const json = JSON.parse(text) as { error?: string }
      if (typeof json.error === 'string' && json.error.trim()) message = json.error.trim()
    } catch {
      /* ignore */
    }
    return { ok: false, code: 'api_error', message }
  } catch (err) {
    console.warn('[discord-channel-messages] worker post failed, falling back to REST', err)
    return null
  }
}

async function postDiscordChannelMessageViaRest(
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

  let lastError: DiscordChannelPostResult = {
    ok: false,
    code: 'api_error',
    message: 'Could not reach Discord.',
  }

  for (let attempt = 1; attempt <= MAX_POST_ATTEMPTS; attempt++) {
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

      const retryable = res.status === 429 || res.status >= 500
      let retryAfterMs = 0
      if (res.status === 429) {
        const header = res.headers.get('retry-after')
        const parsed = header ? Number.parseFloat(header) : Number.NaN
        if (Number.isFinite(parsed) && parsed > 0) {
          retryAfterMs = Math.ceil(parsed * 1000)
        }
      }

      console.error('[discord-channel-messages] post failed', res.status, text.slice(0, 400))
      lastError = {
        ok: false,
        code: 'api_error',
        message: `Discord API error (${res.status}).`,
      }

      if (!retryable || attempt === MAX_POST_ATTEMPTS) return lastError
      await delay(Math.max(retryAfterMs, 600 * attempt))
    } catch (err) {
      console.error('[discord-channel-messages] post error', err)
      lastError = { ok: false, code: 'api_error', message: 'Could not reach Discord.' }
      if (attempt === MAX_POST_ATTEMPTS) return lastError
      await delay(600 * attempt)
    } finally {
      clearTimeout(timer)
    }
  }

  return lastError
}

/**
 * POST /channels/{channel.id}/messages — no @mentions allowed.
 * Prefers Railway Gateway worker when configured (instant full message).
 */
export async function postDiscordChannelMessage(
  channelId: string,
  content: string
): Promise<DiscordChannelPostResult> {
  const viaWorker = await postDiscordChannelMessageViaWorker(channelId, content)
  if (viaWorker) return viaWorker
  return postDiscordChannelMessageViaRest(channelId, content)
}

export type BroadcastChannelTarget = 'public' | 'holder'

function normalizeBroadcastTargets(targets: BroadcastChannelTarget[]): BroadcastChannelTarget[] {
  if (!Array.isArray(targets)) return []
  const unique = new Set<BroadcastChannelTarget>()
  for (const target of targets) {
    if (target === 'public' || target === 'holder') unique.add(target)
  }
  return [...unique]
}

export async function postDiscordBroadcastMessage(
  content: string,
  targets: BroadcastChannelTarget[]
): Promise<{ results: Array<{ target: BroadcastChannelTarget; result: DiscordChannelPostResult }> }> {
  const unique = normalizeBroadcastTargets(targets)
  const jobs = unique.map(async (target) => {
    const channelId =
      target === 'public' ? getDiscordPublicChannelId() : getDiscordHolderChannelId()
    if (!channelId) {
      return {
        target,
        result: {
          ok: false as const,
          code: 'not_configured' as const,
          message:
            target === 'public'
              ? 'DISCORD_CHANNEL_PUBLIC is not set.'
              : 'DISCORD_CHANNEL_HOLDER is not set.',
        },
      }
    }
    const result = await postDiscordChannelMessage(channelId, content)
    return { target, result }
  })

  const results = await Promise.all(jobs)
  return { results }
}
