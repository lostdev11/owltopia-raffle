import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'
import {
  postDiscordIncomingWebhookEmbed,
  type IncomingWebhookMentionOptions,
} from '@/lib/discord-incoming-webhook'
import {
  getDiscordGiveawayPartnerById,
  isPartnerTenantEntitled,
} from '@/lib/db/discord-giveaway-partners'
import { getDiscordUserIdsByWallets } from '@/lib/db/wallet-profiles'
import type { DiscordGiveawayPartnerTenant, NftGiveaway } from '@/lib/types'

function giveawayPageUrl(g: Pick<NftGiveaway, 'id'>): string {
  return `${getSiteBaseUrl()}/giveaway/${encodeURIComponent(g.id)}`
}

function shortenWallet(addr: string): string {
  const t = addr.trim()
  if (t.length <= 12) return t
  return `${t.slice(0, 4)}…${t.slice(-4)}`
}

async function postIfEntitled(
  tenant: DiscordGiveawayPartnerTenant | null,
  embed: Parameters<typeof postDiscordIncomingWebhookEmbed>[1],
  mention?: IncomingWebhookMentionOptions
): Promise<void> {
  if (!tenant || !isPartnerTenantEntitled(tenant)) return
  const url = tenant.webhook_url?.trim()
  if (!url) return
  await postDiscordIncomingWebhookEmbed(url, embed, mention)
}

/** After admin verifies escrow deposit — optional partner ping. */
export async function notifyDiscordPartnerGiveawayReady(g: NftGiveaway): Promise<void> {
  if (!g.discord_partner_tenant_id) return
  try {
    const tenant = await getDiscordGiveawayPartnerById(g.discord_partner_tenant_id)
    const title = g.title?.trim() || 'NFT giveaway'
    const discordMap = await getDiscordUserIdsByWallets([g.eligible_wallet])
    const did = discordMap[g.eligible_wallet] ?? null
    const short = shortenWallet(g.eligible_wallet)
    const walletField =
      did != null
        ? `<@${did}> (\`${short}\`)`
        : `\`${short}\``
    const mention: IncomingWebhookMentionOptions | undefined =
      did != null
        ? {
            content: `Eligible claimant: <@${did}>`,
            allowedMentionUserIds: [did],
          }
        : undefined

    await postIfEntitled(
      tenant,
      {
        title: `${PLATFORM_NAME} — giveaway ready`,
        description: `**${title}** is verified in escrow. Eligible wallet can claim from the dashboard.`,
        url: giveawayPageUrl(g),
        color: 0x57f287,
        fields: [
          {
            name: 'Eligible wallet',
            value: walletField,
            inline: true,
          },
          { name: 'Claim link', value: giveawayPageUrl(g), inline: false },
        ],
        timestamp: new Date().toISOString(),
      },
      mention
    )
  } catch (e) {
    console.error('notifyDiscordPartnerGiveawayReady:', e)
  }
}

/** After successful on-chain claim — optional partner ping. */
export async function notifyDiscordPartnerGiveawayClaimed(g: NftGiveaway): Promise<void> {
  if (!g.discord_partner_tenant_id) return
  try {
    const tenant = await getDiscordGiveawayPartnerById(g.discord_partner_tenant_id)
    const title = g.title?.trim() || 'NFT giveaway'
    const discordMap = await getDiscordUserIdsByWallets([g.eligible_wallet])
    const did = discordMap[g.eligible_wallet] ?? null
    const short = shortenWallet(g.eligible_wallet)
    const mention: IncomingWebhookMentionOptions | undefined =
      did != null
        ? {
            content: `Claimed by: <@${did}>`,
            allowedMentionUserIds: [did],
          }
        : undefined

    await postIfEntitled(
      tenant,
      {
        title: `${PLATFORM_NAME} — giveaway claimed`,
        description: `**${title}** was claimed by the eligible wallet (\`${short}\`).`,
        url: giveawayPageUrl(g),
        color: 0x5865f2,
        fields: g.claim_tx_signature
          ? [
              {
                name: 'Transaction',
                value: `\`${g.claim_tx_signature.slice(0, 8)}…\``,
                inline: true,
              },
            ]
          : undefined,
        timestamp: new Date().toISOString(),
      },
      mention
    )
  } catch (e) {
    console.error('notifyDiscordPartnerGiveawayClaimed:', e)
  }
}
