/**
 * Optional Discord webhook notifications for raffle lifecycle events.
 * Set DISCORD_WEBHOOK_RAFFLE_CREATED / DISCORD_WEBHOOK_RAFFLE_WINNER / DISCORD_WEBHOOK_LIVE_RAFFLES,
 * DISCORD_WEBHOOK_COMMUNITY_GIVEAWAY_WINNER (optional; falls back to raffle winner URL),
 * DISCORD_WEBHOOK_COMMUNITY_GIVEAWAY_OPEN (optional; when a pool giveaway is opened for entries; falls back to LIVE_RAFFLES URL),
 * or DISCORD_WEBHOOK_URL as fallback where noted.
 */
import type { CommunityGiveaway, Raffle } from '@/lib/types'
import { fetchNftImageUriFromHelius } from '@/lib/nft-helius-image'
import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'
import { isAllowedDiscordIncomingWebhookUrl } from '@/lib/discord-webhook-url'
import { parseDiscordUserSnowflake } from '@/lib/discord-webhook-user-mentions'
import { getDiscordUserIdsByWallets } from '@/lib/db/wallet-profiles'

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

/** Pool/community giveaway draw; falls back to raffle winner webhook then global Discord URL. */
function webhookUrlCommunityGiveawayWinner(): string | undefined {
  const specific = process.env.DISCORD_WEBHOOK_COMMUNITY_GIVEAWAY_WINNER?.trim()
  if (specific) return specific
  return webhookUrlWinner()
}

/** When admin opens a community (pool) giveaway for entries; falls back to live-raffles webhook then global URL. */
function webhookUrlCommunityGiveawayOpen(): string | undefined {
  const specific = process.env.DISCORD_WEBHOOK_COMMUNITY_GIVEAWAY_OPEN?.trim()
  if (specific) return specific
  return webhookUrlLiveShare()
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

function communityGiveawayPageUrl(g: Pick<CommunityGiveaway, 'id'>): string {
  const base = getSiteBaseUrl()
  return `${base}/community-giveaway/${encodeURIComponent(g.id)}`
}

/** Normalize metadata image URIs so Discord embeds accept them (https, site-relative, common ipfs/ar schemes). */
function discordEmbedImageFromNftUri(raw: string | null | undefined): string | undefined {
  if (!raw?.trim()) return undefined
  const t = raw.trim()
  try {
    const u = new URL(t)
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString()
  } catch {
    try {
      const base = getSiteBaseUrl()
      const u = new URL(t, `${base}/`)
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString()
    } catch {
      /* fall through */
    }
  }
  if (/^ipfs:\/\//i.test(t)) {
    const path = t.replace(/^ipfs:\/\//i, '').replace(/^\/+/, '')
    return `https://ipfs.io/ipfs/${path}`
  }
  if (/^ar:\/\//i.test(t)) {
    const path = t.replace(/^ar:\/\//i, '').replace(/^\/+/, '')
    return `https://arweave.net/${path}`
  }
  return undefined
}

async function communityGiveawayPrizeImageForDiscord(
  nftMint: string,
  nftTokenId: string | null | undefined
): Promise<string | undefined> {
  const mint = nftMint.trim()
  if (!mint) return undefined
  const assetId = nftTokenId?.trim() || mint
  const raw = await fetchNftImageUriFromHelius(assetId)
  return discordEmbedImageFromNftUri(raw)
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

type WebhookExtras = {
  content?: string
  allowed_mentions?: { parse: []; users: string[] }
}

async function postDiscordWebhookOnce(
  webhookUrl: string,
  embed: DiscordEmbed,
  signal: AbortSignal,
  extras?: WebhookExtras
): Promise<{ ok: boolean; retryable: boolean }> {
  try {
    const body: Record<string, unknown> = {
      username: PLATFORM_NAME,
      embeds: [embed],
    }
    if (extras?.content) body.content = extras.content
    if (extras?.allowed_mentions) body.allowed_mentions = extras.allowed_mentions

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify(body),
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

async function postDiscordWebhook(
  webhookUrl: string,
  embed: DiscordEmbed,
  extras?: WebhookExtras
): Promise<boolean> {
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
      return await postDiscordWebhookOnce(webhookUrl, embed, controller.signal, extras)
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

  const creatorWallet = (
    raffle.creator_wallet?.trim() ||
    (typeof raffle.created_by === 'string' ? raffle.created_by.trim() : '')
  ).trim()
  let creatorDiscordId: string | undefined
  if (creatorWallet) {
    try {
      const map = await getDiscordUserIdsByWallets([creatorWallet])
      const id = map[creatorWallet]?.trim()
      if (id) creatorDiscordId = id
    } catch (e) {
      console.error('[notifyRaffleCreated] creator Discord lookup:', e)
    }
  }
  const creatorSnowflake = parseDiscordUserSnowflake(creatorDiscordId)

  const creatorField =
    creatorWallet && creatorSnowflake
      ? {
          name: 'Creator',
          value: `<@${creatorSnowflake}> (\`${shortenWallet(creatorWallet)}\`)`,
          inline: true,
        }
      : {
          name: 'Creator',
          value: creatorWallet
            ? `\`${shortenWallet(creatorWallet)}\``
            : raffle.created_by
              ? `\`${shortenWallet(String(raffle.created_by))}\``
              : '—',
          inline: true,
        }

  const extras: WebhookExtras | undefined = creatorSnowflake
    ? {
        content: `Raffle creator: <@${creatorSnowflake}>`,
        allowed_mentions: { parse: [], users: [creatorSnowflake] },
      }
    : undefined

  await postDiscordWebhook(
    url,
    {
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
        creatorField,
        { name: 'Status', value: raffle.status ?? 'draft', inline: true },
      ],
      image: image ? { url: image } : undefined,
      timestamp: new Date().toISOString(),
    },
    extras
  )
}

/** Logs errors, never throws. Await from selectWinner (or any serverless handler) so the outgoing webhook finishes before the invocation freezes. */
export async function notifyRaffleWinnerDrawn(
  raffle: Raffle,
  winnerWallet: string,
  statusAfterDraw: string,
  winnerDiscordUserId?: string | null
): Promise<void> {
  const url = webhookUrlWinner()
  if (!url) return

  const statusNote =
    statusAfterDraw === 'successful_pending_claims'
      ? `${statusAfterDraw} (winner/creator claims may be pending)`
      : statusAfterDraw
  const image = resolveDiscordEmbedImageUrl(raffle)

  const discordSnowflake = parseDiscordUserSnowflake(winnerDiscordUserId ?? undefined)

  const winnerField = discordSnowflake
    ? {
        name: 'Winner',
        value: `<@${discordSnowflake}> (\`${shortenWallet(winnerWallet)}\`)`,
        inline: true,
      }
    : { name: 'Winner', value: `\`${shortenWallet(winnerWallet)}\``, inline: true }

  const extras: WebhookExtras | undefined = discordSnowflake
    ? {
        content: `Winner ping: <@${discordSnowflake}>`,
        allowed_mentions: { parse: [], users: [discordSnowflake] },
      }
    : undefined

  await postDiscordWebhook(
    url,
    {
      title: 'Raffle ended — winner drawn',
      description: raffle.title,
      url: rafflePageUrl(raffle),
      color: 0xfee75c,
      fields: [
        winnerField,
        { name: 'Prize', value: prizeSummary(raffle), inline: true },
        {
          name: 'Raffle status',
          value: statusNote,
          inline: false,
        },
      ],
      image: image ? { url: image } : undefined,
      timestamp: new Date().toISOString(),
    },
    extras
  )
}

/**
 * Optional: when an admin opens a community giveaway for entries (draft → open).
 * Uses DISCORD_WEBHOOK_COMMUNITY_GIVEAWAY_OPEN, else DISCORD_WEBHOOK_LIVE_RAFFLES, else DISCORD_WEBHOOK_URL.
 * If `hostDiscordUserId` is set (wallet linked Discord for `created_by_wallet`), pings that user in message content.
 */
export async function notifyCommunityGiveawayOpened(
  giveaway: Pick<
    CommunityGiveaway,
    'id' | 'title' | 'access_gate' | 'starts_at' | 'ends_at' | 'nft_mint_address' | 'nft_token_id'
  >,
  hostDiscordUserId?: string | null
): Promise<void> {
  const url = webhookUrlCommunityGiveawayOpen()
  if (!url) return

  const prizeImage = await communityGiveawayPrizeImageForDiscord(
    giveaway.nft_mint_address,
    giveaway.nft_token_id
  )

  const title = giveaway.title?.trim() || 'Community giveaway'
  const pageUrl = communityGiveawayPageUrl(giveaway)
  const discordSnowflake = parseDiscordUserSnowflake(hostDiscordUserId ?? undefined)
  const startTs = discordTimestampUnix(giveaway.starts_at)
  const owlLine = startTs
    ? `<t:${startTs}:F> (<t:${startTs}:R>)`
    : giveaway.starts_at
  const gateLabel = giveaway.access_gate === 'holder_only' ? 'Owl NFT holders' : 'Everyone'

  const endFields: { name: string; value: string; inline?: boolean }[] = []
  if (giveaway.ends_at) {
    const e = discordTimestampUnix(giveaway.ends_at)
    endFields.push({
      name: 'Entry deadline',
      value: e ? `<t:${e}:F> (<t:${e}:R>)` : giveaway.ends_at,
      inline: false,
    })
  }

  const extras: WebhookExtras | undefined = discordSnowflake
    ? {
        content: `Hosted by: <@${discordSnowflake}>`,
        allowed_mentions: { parse: [], users: [discordSnowflake] },
      }
    : undefined

  await postDiscordWebhook(
    url,
    {
      title: 'Community giveaway — open for entries',
      description: title,
      url: pageUrl,
      color: 0x57f287,
      fields: [
        { name: 'Enter here', value: pageUrl, inline: false },
        { name: 'Access', value: gateLabel, inline: true },
        { name: 'OWL boost deadline', value: owlLine, inline: true },
        ...endFields,
      ],
      image: prizeImage ? { url: prizeImage } : undefined,
      timestamp: new Date().toISOString(),
    },
    extras
  )
}

/**
 * Optional: when an admin draws a community (pool) giveaway winner. Uses
 * DISCORD_WEBHOOK_COMMUNITY_GIVEAWAY_WINNER, else DISCORD_WEBHOOK_RAFFLE_WINNER, else DISCORD_WEBHOOK_URL.
 */
export async function notifyCommunityGiveawayWinnerDrawn(
  giveaway: Pick<CommunityGiveaway, 'id' | 'title' | 'nft_mint_address' | 'nft_token_id'>,
  winnerWallet: string,
  winnerDiscordUserId?: string | null
): Promise<void> {
  const url = webhookUrlCommunityGiveawayWinner()
  if (!url) return

  const prizeImage = await communityGiveawayPrizeImageForDiscord(
    giveaway.nft_mint_address,
    giveaway.nft_token_id
  )

  const title = giveaway.title?.trim() || 'Community giveaway'
  const pageUrl = communityGiveawayPageUrl(giveaway)
  const discordSnowflake = parseDiscordUserSnowflake(winnerDiscordUserId ?? undefined)

  const winnerField = discordSnowflake
    ? {
        name: 'Winner',
        value: `<@${discordSnowflake}> (\`${shortenWallet(winnerWallet)}\`)`,
        inline: true,
      }
    : { name: 'Winner', value: `\`${shortenWallet(winnerWallet)}\``, inline: true }

  const extras: WebhookExtras | undefined = discordSnowflake
    ? {
        content: `Winner ping: <@${discordSnowflake}>`,
        allowed_mentions: { parse: [], users: [discordSnowflake] },
      }
    : undefined

  await postDiscordWebhook(
    url,
    {
      title: 'Community giveaway — winner drawn',
      description: title,
      url: pageUrl,
      color: 0xfee75c,
      fields: [
        winnerField,
        { name: 'Giveaway', value: pageUrl, inline: false },
      ],
      image: prizeImage ? { url: prizeImage } : undefined,
      timestamp: new Date().toISOString(),
    },
    extras
  )
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
