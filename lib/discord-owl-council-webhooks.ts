/**
 * Optional Discord webhook when an admin publishes an Owl Council proposal (draft → active).
 * Set DISCORD_WEBHOOK_OWL_COUNCIL_PROPOSAL_LIVE to an incoming webhook URL.
 */
import { postDiscordIncomingWebhookEmbed } from '@/lib/discord-incoming-webhook'
import { parseDiscordUserSnowflake } from '@/lib/discord-webhook-user-mentions'
import type { OwlProposalRow } from '@/lib/db/owl-council'
import { getDiscordUserIdsByWallets, getWalletProfileForDashboard } from '@/lib/db/wallet-profiles'
import { getSiteBaseUrl } from '@/lib/site-config'

function webhookUrlOwlCouncilProposalLive(): string | undefined {
  return process.env.DISCORD_WEBHOOK_OWL_COUNCIL_PROPOSAL_LIVE?.trim() || undefined
}

function shortenWallet(addr: string): string {
  const t = addr.trim()
  if (t.length <= 12) return t
  return `${t.slice(0, 4)}…${t.slice(-4)}`
}

function proposalPageUrl(slug: string): string {
  const base = getSiteBaseUrl()
  return `${base}/council/${encodeURIComponent(slug)}`
}

function truncateField(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function discordTimeLine(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso.trim()
  const u = Math.floor(ms / 1000)
  return `<t:${u}:F> (<t:${u}:R>)`
}

/**
 * Posts to Discord when a proposal is published. No-op if env unset.
 * Does not throw; logs errors so admin PATCH still succeeds.
 */
export async function notifyOwlCouncilProposalLive(proposal: OwlProposalRow): Promise<void> {
  const url = webhookUrlOwlCouncilProposalLive()
  if (!url) return

  try {
    const wallet = proposal.created_by.trim()
    const [profile, idMap] = await Promise.all([
      getWalletProfileForDashboard(wallet),
      getDiscordUserIdsByWallets([wallet]),
    ])
    const discordSnowflake = parseDiscordUserSnowflake(idMap[wallet] ?? undefined)

    const fields: { name: string; value: string; inline?: boolean }[] = [
      { name: 'Proposer wallet', value: `\`${shortenWallet(wallet)}\``, inline: true },
    ]
    if (profile.displayName) {
      fields.push({
        name: 'Display name',
        value: truncateField(profile.displayName, 256),
        inline: true,
      })
    }
    if (profile.discord.linked && profile.discord.username) {
      fields.push({
        name: 'Discord',
        value: truncateField(profile.discord.username, 256),
        inline: true,
      })
    }

    fields.push(
      { name: 'Voting opens', value: discordTimeLine(proposal.start_time), inline: true },
      { name: 'Voting closes', value: discordTimeLine(proposal.end_time), inline: true }
    )

    const pageUrl = proposalPageUrl(proposal.slug)
    const title = proposal.title.trim() || 'Owl Council proposal'

    await postDiscordIncomingWebhookEmbed(
      url,
      {
        title: 'Owl Council — new proposal',
        description: truncateField(`**${title}**\n\n${proposal.summary}`, 3500),
        url: pageUrl,
        color: 0x5865f2,
        fields: [{ name: 'View & vote', value: pageUrl, inline: false }, ...fields],
        timestamp: new Date().toISOString(),
      },
      discordSnowflake
        ? {
            content: `Submitted by <@${discordSnowflake}>`,
            allowedMentionUserIds: [discordSnowflake],
          }
        : undefined
    )
  } catch (e) {
    console.error('[discord-owl-council] notifyOwlCouncilProposalLive:', e)
  }
}
