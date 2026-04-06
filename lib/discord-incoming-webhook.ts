/**
 * Post a single embed to a Discord incoming webhook (official hosts only).
 * Shared by platform webhooks and partner / paid community webhooks.
 */
import { isAllowedDiscordIncomingWebhookUrl } from '@/lib/discord-webhook-url'
import { PLATFORM_NAME } from '@/lib/site-config'

const WEBHOOK_TIMEOUT_MS = 8_000

export type DiscordIncomingEmbed = {
  title: string
  description?: string
  url?: string
  color: number
  fields?: { name: string; value: string; inline?: boolean }[]
  timestamp?: string
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postOnce(
  webhookUrl: string,
  payload: { username: string; embeds: DiscordIncomingEmbed[]; content?: string },
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

/** Returns false if URL invalid or post failed. */
export async function postDiscordIncomingWebhookEmbed(
  webhookUrl: string,
  embed: DiscordIncomingEmbed
): Promise<boolean> {
  if (!webhookUrl?.trim()) return false
  if (!isAllowedDiscordIncomingWebhookUrl(webhookUrl)) {
    console.error(
      'Discord webhook URL rejected: must be https://discord.com/api/webhooks/{id}/{token} (or canary/ptb/discordapp host)'
    )
    return false
  }

  const attempt = async (): Promise<{ ok: boolean; retryable: boolean }> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
    try {
      return await postOnce(
        webhookUrl,
        { username: PLATFORM_NAME, embeds: [embed] },
        controller.signal
      )
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

/** Optional plain `content` line (e.g. @role ping) plus one embed. */
export async function postDiscordIncomingWebhookContentAndEmbed(
  webhookUrl: string,
  content: string | undefined,
  embed: DiscordIncomingEmbed
): Promise<boolean> {
  if (!webhookUrl?.trim()) return false
  if (!isAllowedDiscordIncomingWebhookUrl(webhookUrl)) {
    console.error('Discord webhook URL rejected for partner post')
    return false
  }
  const payload = {
    username: PLATFORM_NAME,
    content: content?.trim() ? content.trim().slice(0, 1900) : undefined,
    embeds: [embed],
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
