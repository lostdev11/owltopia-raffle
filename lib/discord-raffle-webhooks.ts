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
  image?: { url: string }
  fields?: { name: string; value: string; inline?: boolean }[]
  timestamp?: string
}

export type XShareTemplate = {
  id: string
  label: string
  text: string
  intentUrl: string
}

function resolveDiscordEmbedImageUrl(raffle: Raffle): string | undefined {
  const raw = (raffle.image_url || raffle.image_fallback_url || '').trim()
  if (!raw) return undefined

  try {
    const asAbsolute = new URL(raw)
    if (asAbsolute.protocol !== 'http:' && asAbsolute.protocol !== 'https:') return undefined
    return asAbsolute.toString()
  } catch {
    // Support site-relative media paths by converting to an absolute URL for Discord.
    const base = getSiteBaseUrl()
    try {
      const resolved = new URL(raw, `${base}/`)
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined
      return resolved.toString()
    } catch {
      return undefined
    }
  }
}

function buildXIntentUrl(text: string): string {
  const url = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`
  return url
}

export function buildLiveRaffleXShareTemplates(raffle: Raffle): XShareTemplate[] {
  const pageUrl = rafflePageUrl(raffle)
  const prize = prizeSummary(raffle)
  const title = raffle.title.trim()
  const compactTitle = title.length > 72 ? `${title.slice(0, 69)}...` : title

  const templates: Array<Omit<XShareTemplate, 'intentUrl'>> = [
    {
      id: 'launch',
      label: 'Launch',
      text: `New raffle is LIVE on ${PLATFORM_NAME}: "${compactTitle}"\nPrize: ${prize}\nEnter now: ${pageUrl}\n#Solana #NFT #Raffle`,
    },
    {
      id: 'hype',
      label: 'Hype',
      text: `Community fam, this one is heating up.\n"${compactTitle}" is live now on ${PLATFORM_NAME}.\nGrab your tickets before it closes: ${pageUrl}\n#Solana #Web3`,
    },
    {
      id: 'last-call',
      label: 'Last call',
      text: `Last call for "${compactTitle}" on ${PLATFORM_NAME}.\nPrize: ${prize}\nFinal entries: ${pageUrl}\n#Solana #Crypto`,
    },
  ]

  return templates.map((template) => ({
    ...template,
    intentUrl: buildXIntentUrl(template.text),
  }))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postDiscordWebhookOnce(
  webhookUrl: string,
  embed: DiscordEmbed,
  signal: AbortSignal
): Promise<{ ok: boolean; retryable: boolean }> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        username: PLATFORM_NAME,
        embeds: [embed],
      }),
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

async function postDiscordWebhook(webhookUrl: string, embed: DiscordEmbed): Promise<boolean> {
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
      return await postDiscordWebhookOnce(webhookUrl, embed, controller.signal)
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

/** Logs errors, never throws. Await when calling from API/cron so serverless does not exit before Discord receives the request. */
export async function notifyRaffleCreated(raffle: Raffle): Promise<void> {
  const url = webhookUrlCreated()
  if (!url) return

  const endTs = discordTimestampUnix(raffle.end_time)
  const endLine = endTs ? `<t:${endTs}:F> (<t:${endTs}:R>)` : raffle.end_time
  const image = resolveDiscordEmbedImageUrl(raffle)

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
    image: image ? { url: image } : undefined,
    timestamp: new Date().toISOString(),
  })
}

/** Logs errors, never throws. Await from selectWinner (or any serverless handler) so the outgoing webhook finishes before the invocation freezes. */
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
  const image = resolveDiscordEmbedImageUrl(raffle)

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
    image: image ? { url: image } : undefined,
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
  const image = resolveDiscordEmbedImageUrl(raffle)

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
    image: image ? { url: image } : undefined,
    timestamp: new Date().toISOString(),
  })

  if (!sent) {
    return { ok: false, error: 'Discord returned an error or the request failed' }
  }
  return { ok: true }
}
