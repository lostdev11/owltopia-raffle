/**
 * Post a single embed to a Discord incoming webhook (official hosts only).
 * Shared by platform webhooks and partner / paid community webhooks.
 */
import { isAllowedDiscordIncomingWebhookUrl } from '@/lib/discord-webhook-url'
import { allowedMentionsForUserIds } from '@/lib/discord-webhook-user-mentions'
import { PLATFORM_NAME } from '@/lib/site-config'

const WEBHOOK_TIMEOUT_MS = 8_000

export type DiscordIncomingEmbed = {
  title: string
  description?: string
  url?: string
  color: number
  fields?: { name: string; value: string; inline?: boolean }[]
  /** Large embed image (HTTPS). Prefer `/api/proxy-image` URLs from `resolveNftPrizeImageForDiscordEmbed`. */
  image?: { url: string }
  /** Small corner image (HTTPS). */
  thumbnail?: { url: string }
  footer?: { text: string }
  timestamp?: string
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type IncomingWebhookPayload = {
  username: string
  embeds: DiscordIncomingEmbed[]
  content?: string
  allowed_mentions?: { parse: []; users: string[] }
}

async function postOnce(
  webhookUrl: string,
  payload: IncomingWebhookPayload,
  signal: AbortSignal
): Promise<{ ok: boolean; retryable: boolean }> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify(payload),
    })
    if (res.ok) return { ok: true, retryable: false }
    const text = await res.text().catch(() => '')
    console.error(`Discord webhook failed: ${res.status} ${res.statusText}`, text.slice(0, 200))
    const retryable = res.status === 429 || res.status >= 500
    return { ok: false, retryable }
  } catch (e) {
    console.error('Discord webhook request error:', e)
    return { ok: false, retryable: true }
  }
}

export type IncomingWebhookMentionOptions = {
  /** Plain message line (e.g. `<@userId>` ping). */
  content?: string
  /** Discord user snowflakes; enables ping when combined with `<@id>` in content or embed. */
  allowedMentionUserIds?: string[]
}

/** Returns false if URL invalid or post failed. */
export async function postDiscordIncomingWebhookEmbed(
  webhookUrl: string,
  embed: DiscordIncomingEmbed,
  mention?: IncomingWebhookMentionOptions
): Promise<boolean> {
  if (!webhookUrl?.trim()) return false
  if (!isAllowedDiscordIncomingWebhookUrl(webhookUrl)) {
    console.error(
      'Discord webhook URL rejected: must be https://discord.com/api/webhooks/{id}/{token} (or canary/ptb/discordapp host)'
    )
    return false
  }

  const allowed = allowedMentionsForUserIds(mention?.allowedMentionUserIds ?? [])
  const content = mention?.content?.trim() ? mention.content.trim().slice(0, 1900) : undefined

  const attempt = async (): Promise<{ ok: boolean; retryable: boolean }> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
    try {
      const payload: IncomingWebhookPayload = {
        username: PLATFORM_NAME,
        embeds: [embed],
        ...(content ? { content } : {}),
        ...(allowed ? { allowed_mentions: allowed } : {}),
      }
      return await postOnce(webhookUrl, payload, controller.signal)
    } finally {
      clearTimeout(timer)
    }
  }

  const first = await attempt()
  if (first.ok) return true
  if (!first.retryable) return false
  await delay(900)
  const second = await attempt()
  return second.ok
}

/** Append `?wait=true` so Discord returns the created message JSON (incl. its id). */
function webhookUrlWithWait(webhookUrl: string): string {
  try {
    const u = new URL(webhookUrl)
    u.searchParams.set('wait', 'true')
    return u.toString()
  } catch {
    return webhookUrl
  }
}

/** Build the `.../messages/{id}` URL (preserving any `?thread_id=`) for editing a webhook message. */
function webhookMessageUrl(webhookUrl: string, messageId: string): string | null {
  try {
    const u = new URL(webhookUrl)
    u.pathname = `${u.pathname.replace(/\/$/, '')}/messages/${encodeURIComponent(messageId)}`
    return u.toString()
  } catch {
    return null
  }
}

const MAX_EMBEDS_PER_MESSAGE = 10

/** Post one message carrying multiple embeds (each can render its own image). Returns false on failure. */
export async function postDiscordIncomingWebhookEmbeds(
  webhookUrl: string,
  embeds: DiscordIncomingEmbed[],
  content?: string
): Promise<boolean> {
  if (!webhookUrl?.trim() || embeds.length === 0) return false
  if (!isAllowedDiscordIncomingWebhookUrl(webhookUrl)) {
    console.error('Discord webhook URL rejected for multi-embed post')
    return false
  }
  const payload: IncomingWebhookPayload = {
    username: PLATFORM_NAME,
    embeds: embeds.slice(0, MAX_EMBEDS_PER_MESSAGE),
    ...(content?.trim() ? { content: content.trim().slice(0, 1900) } : {}),
  }
  const attempt = async (): Promise<{ ok: boolean; retryable: boolean }> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
    try {
      return await postOnce(webhookUrl, payload, controller.signal)
    } finally {
      clearTimeout(timer)
    }
  }
  const first = await attempt()
  if (first.ok) return true
  if (!first.retryable) return false
  await delay(900)
  return (await attempt()).ok
}

/** Post a single-embed message and return its Discord message id (via `?wait=true`), or null. */
export async function postDiscordIncomingWebhookEmbedReturnId(
  webhookUrl: string,
  embed: DiscordIncomingEmbed,
  content?: string
): Promise<string | null> {
  if (!webhookUrl?.trim()) return null
  if (!isAllowedDiscordIncomingWebhookUrl(webhookUrl)) {
    console.error('Discord webhook URL rejected for status-message post')
    return null
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
  try {
    const res = await fetch(webhookUrlWithWait(webhookUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        username: PLATFORM_NAME,
        embeds: [embed],
        ...(content?.trim() ? { content: content.trim().slice(0, 1900) } : {}),
      } satisfies IncomingWebhookPayload),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`Discord status-message post failed: ${res.status}`, text.slice(0, 200))
      return null
    }
    const json: { id?: unknown } = await res.json().catch(() => ({}))
    return typeof json.id === 'string' && json.id ? json.id : null
  } catch (e) {
    console.error('Discord status-message post error:', e)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Edit an existing webhook message's embed. Returns 'not_found' when the message was deleted. */
export async function editDiscordIncomingWebhookEmbed(
  webhookUrl: string,
  messageId: string,
  embed: DiscordIncomingEmbed,
  content?: string
): Promise<'ok' | 'not_found' | 'failed'> {
  if (!webhookUrl?.trim() || !messageId.trim()) return 'failed'
  if (!isAllowedDiscordIncomingWebhookUrl(webhookUrl)) return 'failed'
  const url = webhookMessageUrl(webhookUrl, messageId)
  if (!url) return 'failed'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        embeds: [embed],
        ...(content?.trim() ? { content: content.trim().slice(0, 1900) } : {}),
      }),
    })
    if (res.ok) return 'ok'
    if (res.status === 404) return 'not_found'
    const text = await res.text().catch(() => '')
    console.error(`Discord status-message edit failed: ${res.status}`, text.slice(0, 200))
    return 'failed'
  } catch (e) {
    console.error('Discord status-message edit error:', e)
    return 'failed'
  } finally {
    clearTimeout(timer)
  }
}

/** Optional plain `content` line (e.g. @role ping) plus one embed. */
export async function postDiscordIncomingWebhookContentAndEmbed(
  webhookUrl: string,
  content: string | undefined,
  embed: DiscordIncomingEmbed,
  allowedMentionUserIds?: string[]
): Promise<boolean> {
  if (!webhookUrl?.trim()) return false
  if (!isAllowedDiscordIncomingWebhookUrl(webhookUrl)) {
    console.error('Discord webhook URL rejected for partner post')
    return false
  }
  const allowed = allowedMentionsForUserIds(allowedMentionUserIds ?? [])
  const payload: IncomingWebhookPayload = {
    username: PLATFORM_NAME,
    content: content?.trim() ? content.trim().slice(0, 1900) : undefined,
    embeds: [embed],
    ...(allowed ? { allowed_mentions: allowed } : {}),
  }
  const attempt = async (): Promise<{ ok: boolean; retryable: boolean }> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
    try {
      return await postOnce(webhookUrl, payload, controller.signal)
    } finally {
      clearTimeout(timer)
    }
  }
  const first = await attempt()
  if (first.ok) return true
  if (!first.retryable) return false
  await delay(900)
  const second = await attempt()
  return second.ok
}
