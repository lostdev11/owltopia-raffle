import { getSiteBaseUrl } from '@/lib/site-config'

export type CommunityGiveawayDiscordPayload = {
  id: string
  title: string
  description: string | null
  access_gate: string
  starts_at: string
  ends_at: string | null
  nft_mint_address: string | null
}

function discordWebhookUrl(): string | null {
  const primary = process.env.DISCORD_COMMUNITY_GIVEAWAY_WEBHOOK_URL?.trim()
  const fallback = process.env.DISCORD_WEBHOOK_URL?.trim()
  return primary || fallback || null
}

function shortenMint(mint: string | null | undefined): string {
  const m = (mint || '').trim()
  if (m.length <= 12) return m || '—'
  return `${m.slice(0, 4)}…${m.slice(-4)}`
}

function giveawayPageUrl(id: string): string {
  const base = getSiteBaseUrl()
  return `${base}/community-giveaway/${id}`
}

function discordTimestampUnix(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? Math.floor(t / 1000) : null
}

/**
 * Posts a Discord embed when a community giveaway becomes publicly visible
 * (status open + prize in escrow). No-op if no webhook URL is configured.
 */
export async function notifyDiscordCommunityGiveawayStarted(
  g: CommunityGiveawayDiscordPayload
): Promise<void> {
  const url = discordWebhookUrl()
  if (!url) return

  const pageUrl = giveawayPageUrl(g.id)
  const endTs = discordTimestampUnix(g.ends_at)
  const endLine = endTs ? `<t:${endTs}:F> (<t:${endTs}:R>)` : g.ends_at || '—'
  const accessLabel =
    g.access_gate === 'holder_only' ? 'Owl NFT holders only' : 'Everyone'

  const body = {
    embeds: [
      {
        title: 'Community giveaway is live',
        description: g.title,
        url: pageUrl,
        color: 0x5865f2,
        fields: [
          { name: 'Enter here', value: pageUrl, inline: false },
          { name: 'Access', value: accessLabel, inline: true },
          { name: 'Prize mint', value: `\`${shortenMint(g.nft_mint_address)}\``, inline: true },
          { name: 'Entry deadline', value: endLine, inline: false },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[discord community giveaway] webhook failed', res.status, text.slice(0, 200))
    }
  } catch (e) {
    console.error('[discord community giveaway] webhook error', e)
  }
}

export function isCommunityGiveawayPubliclyVisible(row: {
  status?: string | null
  prize_deposited_at?: string | null
}): boolean {
  return row.status === 'open' && !!row.prize_deposited_at
}
