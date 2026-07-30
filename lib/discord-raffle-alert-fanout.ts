/**
 * Fan-out new public live raffles to Discord servers opted in via /owltopia-alerts.
 */
import type { Raffle } from '@/lib/types'
import {
  claimRaffleCommunityDiscordAlert,
  listEnabledDiscordRaffleAlertSubscriptions,
} from '@/lib/db/discord-raffle-alert-subscriptions'
import { postDiscordChannelEmbed } from '@/lib/discord-channel-messages'
import { formatRaffleTicketPriceSummary } from '@/lib/raffles/dual-ticket-payment'
import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'

const FANOUT_CONCURRENCY = 4

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

function resolveDiscordEmbedImageUrl(raffle: Raffle): string | undefined {
  const fallback = (raffle.image_fallback_url || '').trim()
  const primary = (raffle.image_url || '').trim()
  const raw = fallback || primary
  if (!raw) return undefined

  try {
    const asAbsolute = new URL(raw)
    if (asAbsolute.protocol !== 'http:' && asAbsolute.protocol !== 'https:') return undefined
    return asAbsolute.toString()
  } catch {
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

function isEligibleForCommunityRaffleAlert(raffle: Raffle): boolean {
  if (raffle.list_on_platform === false) return false
  if (raffle.is_active === false) return false
  if (raffle.status !== 'live') return false
  const endMs = new Date(raffle.end_time).getTime()
  if (Number.isFinite(endMs) && endMs <= Date.now()) return false
  return true
}

async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return
  const limit = Math.max(1, concurrency)
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++
      await fn(items[i]!)
    }
  })
  await Promise.all(workers)
}

/**
 * Post a "new raffle live" embed to every enabled alert subscription.
 * Idempotent via raffles.discord_community_alert_posted_at claim.
 * Never throws — safe to call from publish / create / promote paths.
 */
export async function notifyCommunityDiscordRaffleAlerts(raffle: Raffle): Promise<void> {
  try {
    if (!isEligibleForCommunityRaffleAlert(raffle)) return

    const claimed = await claimRaffleCommunityDiscordAlert(raffle.id)
    if (!claimed) return

    const subs = await listEnabledDiscordRaffleAlertSubscriptions()
    if (subs.length === 0) return

    const endTs = discordTimestampUnix(raffle.end_time)
    const endLine = endTs ? `<t:${endTs}:F> (<t:${endTs}:R>)` : raffle.end_time
    const image = resolveDiscordEmbedImageUrl(raffle)

    const embed = {
      title: `New raffle on ${PLATFORM_NAME}`,
      description: raffle.title,
      url: rafflePageUrl(raffle),
      color: 0x57f287,
      fields: [
        { name: 'Prize', value: prizeSummary(raffle), inline: true },
        {
          name: 'Ticket price',
          value: formatRaffleTicketPriceSummary(raffle),
          inline: true,
        },
        { name: 'Ends', value: endLine, inline: false },
        {
          name: 'Enter',
          value: `[Open raffle](${rafflePageUrl(raffle)})`,
          inline: false,
        },
      ],
      image: image ? { url: image } : undefined,
      footer: { text: `${PLATFORM_NAME} · Free raffle alerts` },
      timestamp: new Date().toISOString(),
    }

    await mapPool(subs, FANOUT_CONCURRENCY, async (sub) => {
      const result = await postDiscordChannelEmbed(sub.channel_id, embed)
      if (!result.ok) {
        console.error(
          '[discord-raffle-alerts] fan-out failed',
          sub.discord_guild_id,
          sub.channel_id,
          result.code,
          result.message
        )
      }
    })
  } catch (e) {
    console.error('[discord-raffle-alerts] notifyCommunityDiscordRaffleAlerts:', e)
  }
}
