import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'
import { PARTNER_PRO_SETUP_USD } from '@/lib/config/partner-program-pricing'
import {
  getDiscordGiveawayPartnerByGuildId,
  isPartnerTenantEntitled,
  updateDiscordGiveawayPartner,
} from '@/lib/db/discord-giveaway-partners'
import { getDiscordBotInviteUrl } from '@/lib/discord-bot-invite'
import { isAllowedDiscordIncomingWebhookUrl } from '@/lib/discord-webhook-url'
import { assertDiscordPartnerCommandAccess } from '@/lib/discord-partner-command-access'
import { handleDiscordMarketplaceCommand } from '@/lib/discord-marketplace-handle-interaction'
import { handleDiscordRaffleAlertsCommand } from '@/lib/discord-raffle-alerts-handle-interaction'
import { handleDiscordQueryCommand, handleDiscordWlCommand } from '@/lib/discord-wl-handle-interaction'

const MANAGE_WEBHOOKS_BIT = 1n << 29n

function ephemeral(content: string) {
  return {
    type: 4,
    data: {
      content: content.slice(0, 2000),
      flags: 64,
    },
  }
}

function partnerProBillingHelp(): string {
  const base = getSiteBaseUrl()
  const invite = getDiscordBotInviteUrl()
  const lines = [
    `**${PLATFORM_NAME} Partner Pro — one-time setup**`,
    '',
    `Partner Pro is a **one-time $${PARTNER_PRO_SETUP_USD} setup** (plus the 2% partner raffle fee).`,
    '**Monthly Discord USDC renewals are discontinued.** Discord tools (whitelist, webhooks) are included with Partner Pro.',
    '',
    'If you already paid Partner Pro: ask Owltopia to link this Discord server in Owl Vision → Partners (wallet + server ID).',
    `Apply / details: ${base}/partner-program`,
  ]
  if (invite) lines.push('', `**Add the bot:** ${invite}`)
  return lines.join('\n')
}

type DiscordInteraction = {
  type: number
  guild_id?: string
  channel_id?: string
  member?: { permissions?: string; user?: { id: string } }
  data?: {
    name?: string
    options?: Array<{ name: string; type: number; value?: string; options?: unknown[] }>
  }
}

function getSubcommandAndOptions(data: DiscordInteraction['data']): {
  sub: string | null
  strOptions: Record<string, string>
} {
  const opts = data?.options ?? []
  const sub = opts.find((o) => o.type === 1)
  if (!sub) return { sub: null, strOptions: {} }
  const strOptions: Record<string, string> = {}
  const nested = (sub.options ?? []) as Array<{ name: string; type: number; value?: string }>
  for (const o of nested) {
    if (o.type === 3 && typeof o.value === 'string') strOptions[o.name] = o.value
  }
  return { sub: sub.name ?? null, strOptions }
}

function memberCanManageWebhooks(member: DiscordInteraction['member']): boolean {
  if (!member?.permissions) return false
  try {
    return (BigInt(member.permissions) & MANAGE_WEBHOOKS_BIT) !== 0n
  } catch {
    return false
  }
}

export async function handleDiscordApplicationCommand(
  interaction: DiscordInteraction
): Promise<Record<string, unknown>> {
  const guildId = interaction.guild_id
  if (!guildId) {
    return ephemeral('Use this command in a server, not in DMs.')
  }

  const root = interaction.data?.name
  if (root === 'owltopia-shop') {
    return handleDiscordMarketplaceCommand(interaction)
  }
  if (root === 'owltopia-alerts') {
    return handleDiscordRaffleAlertsCommand(interaction)
  }
  if (root === 'owltopia-wl') {
    return handleDiscordWlCommand(interaction)
  }
  if (root === 'query') {
    return handleDiscordQueryCommand(interaction)
  }
  if (root !== 'owltopia-partner') {
    return ephemeral('Unknown command.')
  }

  const { sub, strOptions } = getSubcommandAndOptions(interaction.data)

  const access = await assertDiscordPartnerCommandAccess(interaction.member?.user?.id, guildId)
  if (!access.ok) {
    return ephemeral(access.message)
  }

  if (!access.isFounder && !memberCanManageWebhooks(interaction.member)) {
    return ephemeral(
      'You need **Manage Webhooks** (or server Administrator) to run Owltopia partner commands. Ask a server admin to run these, or link your own admin Discord on the Owltopia dashboard if you are Partner Pro.'
    )
  }

  if (sub === 'subscribe') {
    return ephemeral(partnerProBillingHelp())
  }

  if (sub === 'verify') {
    return ephemeral(
      [
        '**Monthly Discord payment verify is discontinued.**',
        '',
        `Partner Pro is a one-time $${PARTNER_PRO_SETUP_USD} setup — no USDC subscribe/verify cycle.`,
        'If you already paid Partner Pro, ask Owltopia to link this server in **Owl Vision → Partners**.',
        `Then use \`/owltopia-partner webhook\` / \`/owltopia-wl\` here.`,
      ].join('\n')
    )
  }

  if (sub === 'webhook') {
    const url = (strOptions.url ?? '').trim()
    if (!url || !isAllowedDiscordIncomingWebhookUrl(url)) {
      return ephemeral('Invalid webhook URL. Use a Discord **incoming** webhook (`https://discord.com/api/webhooks/…`).')
    }
    const partner = await getDiscordGiveawayPartnerByGuildId(guildId)
    if (!partner) {
      return ephemeral(
        'No partner Discord link for this server yet. Ask Owltopia to link your Partner Pro wallet + server ID in Owl Vision → Partners.'
      )
    }
    if (!isPartnerTenantEntitled(partner)) {
      return ephemeral(
        'This Discord partner link is suspended. Ask Owltopia support to reactivate it (Partner Pro is one-time — no monthly renew).'
      )
    }
    const updated = await updateDiscordGiveawayPartner(partner.id, { webhook_url: url })
    if (!updated) return ephemeral('Could not save webhook.')
    return ephemeral('Webhook saved. Linked NFT giveaways will post here when deposit is verified or claimed.')
  }

  if (sub === 'webhook-raffle-created' || sub === 'webhook-raffle-winner') {
    const url = (strOptions.url ?? '').trim()
    if (!url || !isAllowedDiscordIncomingWebhookUrl(url)) {
      return ephemeral('Invalid webhook URL. Use a Discord **incoming** webhook (`https://discord.com/api/webhooks/…`).')
    }
    const partner = await getDiscordGiveawayPartnerByGuildId(guildId)
    if (!partner) {
      return ephemeral(
        'No partner Discord link for this server yet. Ask Owltopia to link your Partner Pro wallet + server ID in Owl Vision → Partners.'
      )
    }
    if (!isPartnerTenantEntitled(partner)) {
      return ephemeral(
        'This Discord partner link is suspended. Ask Owltopia support to reactivate it (Partner Pro is one-time — no monthly renew).'
      )
    }
    const field =
      sub === 'webhook-raffle-created'
        ? { raffle_webhook_url_created: url as string }
        : { raffle_webhook_url_winner: url as string }
    const updated = await updateDiscordGiveawayPartner(partner.id, field)
    if (!updated) return ephemeral('Could not save webhook.')
    return ephemeral(
      sub === 'webhook-raffle-created'
        ? 'Raffle **created** webhook saved. New ticket raffles from a linked partner creator will post here (when Owltopia also posts main feeds).'
        : 'Raffle **winner** webhook saved. When a draw completes, a ping will post here; winners claim on the Owltopia user **dashboard**.'
    )
  }

  if (sub === 'status') {
    let partner
    try {
      partner = await getDiscordGiveawayPartnerByGuildId(guildId)
    } catch (e) {
      console.error('status partner query:', e)
      return ephemeral(
        'Could not load status (database error). Set SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) on the server for the Supabase project with tables from migrations 052 and 053, then redeploy.'
      )
    }
    if (!partner) {
      return ephemeral(
        [
          'No Partner Pro Discord link for this server yet.',
          'Ask Owltopia to link your wallet + server ID in Owl Vision → Partners (one-time Partner Pro — no monthly subscribe).',
        ].join('\n')
      )
    }
    const rwc = partner.raffle_webhook_url_created ? 'set' : '**not set**'
    const rww = partner.raffle_webhook_url_winner ? 'set' : '**not set**'
    return ephemeral(
      [
        `**Partner id:** \`${partner.id}\``,
        `**Status:** ${partner.status}`,
        `**Billing:** Partner Pro one-time (no monthly Discord renew)`,
        `**Webhook (NFT / API):** ${partner.webhook_url ? 'configured' : '**not set** — run /webhook'}`,
        `**Raffle created channel:** ${rwc} — \`/owltopia-partner webhook-raffle-created\``,
        `**Raffle winner channel:** ${rww} — \`/owltopia-partner webhook-raffle-winner\``,
        `**Entitled:** ${isPartnerTenantEntitled(partner) ? 'yes' : 'no'}`,
      ].join('\n')
    )
  }

  return ephemeral('Unknown subcommand.')
}
