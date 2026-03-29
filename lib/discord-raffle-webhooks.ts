/**
 * Optional Discord webhook notifications for raffle lifecycle events.
 * Set DISCORD_WEBHOOK_RAFFLE_CREATED / DISCORD_WEBHOOK_RAFFLE_WINNER / DISCORD_WEBHOOK_LIVE_RAFFLES,
 * or DISCORD_WEBHOOK_URL as fallback where noted.
 */
import type { Raffle } from '@/lib/types'
import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'
import { isAllowedDiscordIncomingWebhookUrl } from '@/lib/discord-webhook-url'

const WEBHOOK_TIMEOUT_MS = 8_000

function webhookUrlCreated(): string | undefined {
  const specific = process.env.DISCORD_WEBHOOK_RAFFLE_CREATED?.trim()
  if (specific) return specific
  return process.env.DISCORD_WEBHOOK_URL?.trim() || undefined
}

function webhookUrlWinner(): string | undefined {
  const specific = process.env.DISCORD_WEBHOOK_RAFFLE_WINNER?.trim()
  if (specific) return specific
  return process.env.DISCORD_WEBHOOK_URL?.trim() || undefined
}

function webhookUrlLiveShare(): string | undefined {
  const specific = process.env.DISCORD_WEBHOOK_LIVE_RAFFLES?.trim()
  if (specific) return specific
  return process.env.DISCORD_WEBHOOK_URL?.trim() || undefined
}

function shortenWallet(addr: string): string {
  const t = addr.trim()
  if (t.length <= 12) return t
  return `${t.slice(0, 4)}…${t.slice(-4)}`
}

function prizeSummary(raffle: Raffle): string {
  if (raffle.prize_type === 'nft') {
    const name = raffle.nft_collection_name?.trim()
    return name ? `NFT — ${name}` : 'NFT prize'
  }
  const amt = raffle.prize_amount
  const cur = raffle.prize_currency?.trim() || 'SOL'
  if (amt != null && Number.isFinite(Number(amt))) {
    return `${amt} ${cur}`
  }
  return `${cur} prize`
}

function rafflePageUrl(raffle: Raffle): string {
  const base = getSiteBaseUrl()
  return `${base}/raffles/${encodeURIComponent(raffle.slug)}`
}

function discordTimestampUnix(iso: string): number | null {
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return null
  return Math.floor(ms / 1000)
}

type DiscordEmbed = {
  title: string
  description?: string
  url?: string
  color: number
  fields?: { name: string; value: string; inline?: boolean }[]
  timestamp?: string
}

async function postDiscordWebhook(webhookUrl: string, embed: DiscordEmbed): Promise<boolean> {
  if (!isAllowedDiscordIncomingWebhookUrl(webhookUrl)) {
    console.error(
      'Discord webhook URL rejected: must be https://discord.com/api/webhooks/{id}/{token} (or canary/ptb/discordapp host)'
    )
    return false
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        username: PLATFORM_NAME,
        embeds: [embed],
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`Discord webhook failed: ${res.status} ${res.statusText}`, text.slice(0, 200))
      return false
    }
    return true
  } catch (e) {
    console.error('Discord webhook request error:', e)
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Fire-and-forget safe: logs errors, never throws. */
export async function notifyRaffleCreated(raffle: Raffle): Promise<void> {
  const url = webhookUrlCreated()
  if (!url) return

  const endTs = discordTimestampUnix(raffle.end_time)
  const endLine = endTs ? `<t:${endTs}:F> (<t:${endTs}:R>)` : raffle.end_time

  await postDiscordWebhook(url, {
    title: 'New raffle created',
    description: raffle.title,
    url: rafflePageUrl(raffle),
    color: 0x57f287,
    fields: [
      { name: 'Prize', value: prizeSummary(raffle), inline: true },
      {
        name: 'Ticket price',
        value: `${raffle.ticket_price} ${raffle.currency}`,
        inline: true,
      },
      { name: 'Ends', value: endLine, inline: false },
      {
        name: 'Creator',
        value: raffle.creator_wallet
          ? `\`${shortenWallet(raffle.creator_wallet)}\``
          : raffle.created_by
            ? `\`${shortenWallet(String(raffle.created_by))}\``
            : '—',
        inline: true,
      },
      { name: 'Status', value: raffle.status ?? 'draft', inline: true },
    ],
    timestamp: new Date().toISOString(),
  })
}

/** Fire-and-forget safe: logs errors, never throws. */
export async function notifyRaffleWinnerDrawn(
  raffle: Raffle,
  winnerWallet: string,
  statusAfterDraw: string
): Promise<void> {
  const url = webhookUrlWinner()
  if (!url) return

  const statusNote =
    statusAfterDraw === 'successful_pending_claims'
      ? `${statusAfterDraw} (winner/creator claims may be pending)`
      : statusAfterDraw

  await postDiscordWebhook(url, {
    title: 'Raffle ended — winner drawn',
    description: raffle.title,
    url: rafflePageUrl(raffle),
    color: 0xfee75c,
    fields: [
      { name: 'Winner', value: `\`${shortenWallet(winnerWallet)}\``, inline: true },
      { name: 'Prize', value: prizeSummary(raffle), inline: true },
      {
        name: 'Raffle status',
        value: statusNote,
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
  })
}

/**
 * Manual admin “post to Discord” for a live raffle. Uses DISCORD_WEBHOOK_LIVE_RAFFLES, or DISCORD_WEBHOOK_URL.
 */
export async function pushLiveRaffleToDiscord(raffle: Raffle): Promise<{ ok: boolean; error?: string }> {
  const url = webhookUrlLiveShare()
  if (!url) {
    return { ok: false, error: 'DISCORD_WEBHOOK_LIVE_RAFFLES (or DISCORD_WEBHOOK_URL) is not set' }
  }
  if (!isAllowedDiscordIncomingWebhookUrl(url)) {
    return {
      ok: false,
      error: 'Live webhook URL in env is not a valid Discord incoming webhook URL (https only, discord.com/api/webhooks/…)',
    }
  }

  const pageUrl = rafflePageUrl(raffle)
  const endTs = discordTimestampUnix(raffle.end_time)
  const endLine = endTs ? `<t:${endTs}:F> (<t:${endTs}:R>)` : raffle.end_time

  const sent = await postDiscordWebhook(url, {
    title: 'Live raffle',
    description: raffle.title,
    url: pageUrl,
    color: 0x5865f2,
    fields: [
      { name: 'Enter here', value: pageUrl, inline: false },
      { name: 'Prize', value: prizeSummary(raffle), inline: true },
      { name: 'Ticket price', value: `${raffle.ticket_price} ${raffle.currency}`, inline: true },
      { name: 'Ends', value: endLine, inline: false },
    ],
    timestamp: new Date().toISOString(),
  })

  if (!sent) {
    return { ok: false, error: 'Discord returned an error or the request failed' }
  }
  return { ok: true }
}
