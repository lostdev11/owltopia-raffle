import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'
import { postDiscordIncomingWebhookEmbed } from '@/lib/discord-incoming-webhook'
import {
  getDiscordGiveawayPartnerById,
  isPartnerTenantEntitled,
} from '@/lib/db/discord-giveaway-partners'
import type { DiscordGiveawayPartnerTenant, NftGiveaway } from '@/lib/types'

function giveawayPageUrl(g: Pick<NftGiveaway, 'id'>): string {
  return `${getSiteBaseUrl()}/giveaway/${encodeURIComponent(g.id)}`
}

async function postIfEntitled(
  tenant: DiscordGiveawayPartnerTenant | null,
  embed: Parameters<typeof postDiscordIncomingWebhookEmbed>[1]
): Promise<void> {
  if (!tenant || !isPartnerTenantEntitled(tenant)) return
  const url = tenant.webhook_url?.trim()
  if (!url) return
  await postDiscordIncomingWebhookEmbed(url, embed)
}

/** After admin verifies escrow deposit — optional partner ping. */
export async function notifyDiscordPartnerGiveawayReady(g: NftGiveaway): Promise<void> {
  if (!g.discord_partner_tenant_id) return
  try {
    const tenant = await getDiscordGiveawayPartnerById(g.discord_partner_tenant_id)
    const title = g.title?.trim() || 'NFT giveaway'
    await postIfEntitled(tenant, {
      title: `${PLATFORM_NAME} — giveaway ready`,
      description: `**${title}** is verified in escrow. Eligible wallet can claim from the dashboard.`,
      url: giveawayPageUrl(g),
      color: 0x57f287,
      fields: [
        {
          name: 'Eligible wallet',
          value: `\`${g.eligible_wallet.slice(0, 4)}…${g.eligible_wallet.slice(-4)}\``,
          inline: true,
        },
        { name: 'Claim link', value: giveawayPageUrl(g), inline: false },
      ],
      timestamp: new Date().toISOString(),
    })
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
    await postIfEntitled(tenant, {
      title: `${PLATFORM_NAME} — giveaway claimed`,
      description: `**${title}** was claimed by the eligible wallet.`,
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
    })
  } catch (e) {
    console.error('notifyDiscordPartnerGiveawayClaimed:', e)
  }
}
