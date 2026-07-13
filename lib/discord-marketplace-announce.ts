/**
 * Post marketplace listing announcements with a Quick buy button.
 * Prefers Bot channel messages (components route to /api/discord/interactions).
 * Falls back to incoming webhook without buttons.
 */
import {
  postDiscordIncomingWebhookEmbed,
  type DiscordIncomingEmbed,
} from '@/lib/discord-incoming-webhook'
import { isAllowedDiscordIncomingWebhookUrl } from '@/lib/discord-webhook-url'
import { quickBuyCustomId } from '@/lib/discord-marketplace-buy'

const DISCORD_API = 'https://discord.com/api/v10'

function marketplaceWebhookUrl(): string | undefined {
  return (
    process.env.DISCORD_WEBHOOK_MARKETPLACE?.trim() ||
    process.env.DISCORD_WEBHOOK_URL?.trim() ||
    undefined
  )
}

function botToken(): string | undefined {
  return process.env.DISCORD_BOT_TOKEN?.trim() || undefined
}

function configuredChannelId(): string | undefined {
  return process.env.DISCORD_MARKETPLACE_CHANNEL_ID?.trim() || undefined
}

async function resolveChannelIdFromWebhook(webhookUrl: string): Promise<string | null> {
  try {
    const res = await fetch(webhookUrl, { method: 'GET' })
    if (!res.ok) return null
    const json = (await res.json().catch(() => null)) as { channel_id?: unknown } | null
    return typeof json?.channel_id === 'string' && json.channel_id ? json.channel_id : null
  } catch {
    return null
  }
}

function quickBuyRow(customId: string, label = 'Quick buy') {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 3,
        label: label.slice(0, 80),
        custom_id: customId.slice(0, 100),
      },
      {
        type: 2,
        style: 2,
        label: 'Connect wallet',
        custom_id: 'owlshop_qb:help:connect'.slice(0, 100),
      },
    ],
  }
}

async function postBotChannelMessage(params: {
  channelId: string
  token: string
  content: string
  embed: DiscordIncomingEmbed
  components: unknown[]
}): Promise<boolean> {
  try {
    const res = await fetch(`${DISCORD_API}/channels/${encodeURIComponent(params.channelId)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${params.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: params.content.slice(0, 1900),
        embeds: [params.embed],
        components: params.components,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[discord-marketplace] bot channel post failed', res.status, text.slice(0, 300))
      return false
    }
    return true
  } catch (e) {
    console.error('[discord-marketplace] bot channel post error', e)
    return false
  }
}

/**
 * Announce a listing with optional Quick buy button.
 * customIdKind: shop item | nft listing | legacy product
 */
export async function postMarketplaceListingAnnouncement(params: {
  embed: DiscordIncomingEmbed
  quickBuy: { kind: 'item' | 'nft' | 'prod'; slug: string } | null
}): Promise<void> {
  const content = '🛒 **New marketplace listing**'
  const webhook = marketplaceWebhookUrl()
  const token = botToken()
  const components = params.quickBuy
    ? [quickBuyRow(quickBuyCustomId(params.quickBuy.kind, params.quickBuy.slug))]
    : []

  let channelId = configuredChannelId() || null
  if (!channelId && webhook && isAllowedDiscordIncomingWebhookUrl(webhook)) {
    channelId = await resolveChannelIdFromWebhook(webhook)
  }

  if (token && channelId && components.length > 0) {
    const ok = await postBotChannelMessage({
      channelId,
      token,
      content,
      embed: params.embed,
      components,
    })
    if (ok) return
  }

  if (webhook) {
    try {
      await postDiscordIncomingWebhookEmbed(webhook, params.embed, { content })
    } catch (e) {
      console.error('[discord-marketplace-webhook] post failed:', e)
    }
  }
}

export function marketplaceFeeFieldValue(): string | null {
  const raw = process.env.DISCORD_MARKETPLACE_PURCHASE_FEE_USD?.trim()
  const n = raw ? Number(raw) : 1
  const usd = Number.isFinite(n) && n >= 0 ? n : 1
  if (usd <= 0) return null
  return `~$${usd.toFixed(usd % 1 === 0 ? 0 : 2)} SOL platform fee on SOL/OWL checkout`
}
