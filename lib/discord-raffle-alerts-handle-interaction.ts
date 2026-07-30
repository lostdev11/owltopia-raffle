import {
  disableDiscordRaffleAlertSubscription,
  getDiscordRaffleAlertSubscription,
  upsertDiscordRaffleAlertSubscription,
} from '@/lib/db/discord-raffle-alert-subscriptions'
import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'

const ADMINISTRATOR_BIT = 0x8n
const MANAGE_CHANNELS_BIT = 0x10n
const MANAGE_GUILD_BIT = 0x20n

function ephemeral(content: string) {
  return {
    type: 4,
    data: {
      content: content.slice(0, 2000),
      flags: 64,
    },
  }
}

type DiscordInteraction = {
  type: number
  guild_id?: string
  member?: { permissions?: string; user?: { id: string } }
  data?: {
    name?: string
    options?: Array<{
      name: string
      type: number
      value?: string
      options?: Array<{ name: string; type: number; value?: string }>
    }>
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
  const nested = sub.options ?? []
  for (const o of nested) {
    // 3 = STRING, 7 = CHANNEL (snowflake string)
    if ((o.type === 3 || o.type === 7) && typeof o.value === 'string') {
      strOptions[o.name] = o.value
    }
  }
  return { sub: sub.name ?? null, strOptions }
}

function memberCanManageAlerts(member: DiscordInteraction['member']): boolean {
  if (!member?.permissions) return false
  try {
    const perms = BigInt(member.permissions)
    return (
      (perms & ADMINISTRATOR_BIT) !== 0n ||
      (perms & MANAGE_GUILD_BIT) !== 0n ||
      (perms & MANAGE_CHANNELS_BIT) !== 0n
    )
  } catch {
    return false
  }
}

function botInviteUrl(): string | null {
  const custom = process.env.DISCORD_BOT_INVITE_URL?.trim()
  if (custom) return custom
  const appId = process.env.DISCORD_APPLICATION_ID?.trim()
  if (!appId) return null
  // View Channel + Send Messages + Embed Links + Use Application Commands
  const perms = '2147503104'
  return `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(appId)}&permissions=${perms}&scope=bot%20applications.commands`
}

export async function handleDiscordRaffleAlertsCommand(
  interaction: DiscordInteraction
): Promise<Record<string, unknown>> {
  const guildId = interaction.guild_id?.trim()
  if (!guildId) {
    return ephemeral('Use this command in a server, not in DMs.')
  }

  if (!memberCanManageAlerts(interaction.member)) {
    return ephemeral(
      'You need **Manage Channels**, **Manage Server**, or **Administrator** to configure Owltopia raffle alerts.'
    )
  }

  const { sub, strOptions } = getSubcommandAndOptions(interaction.data)
  const userId = interaction.member?.user?.id?.trim() || null
  const site = getSiteBaseUrl()

  if (sub === 'enable') {
    const channelId = strOptions.channel?.trim()
    if (!channelId) {
      return ephemeral('Pick a text channel with the `channel` option.')
    }
    if (!/^\d{5,32}$/.test(channelId)) {
      return ephemeral('That channel id looks invalid. Pick a text channel from the menu.')
    }

    try {
      await upsertDiscordRaffleAlertSubscription({
        discord_guild_id: guildId,
        channel_id: channelId,
        configured_by_discord_user_id: userId,
      })
    } catch (e) {
      console.error('[owltopia-alerts] enable:', e)
      return ephemeral(
        'Could not save alert settings (database error). Ask Owltopia to confirm migration `207_discord_raffle_alert_subscriptions` is applied.'
      )
    }

    const invite = botInviteUrl()
    const lines = [
      `**${PLATFORM_NAME} raffle alerts enabled**`,
      '',
      `New **public live** raffles will be posted in <#${channelId}>.`,
      '',
      'Make sure the Owltopia bot can **View Channel**, **Send Messages**, and **Embed Links** there.',
      `Browse raffles: ${site}/raffles`,
    ]
    if (invite) {
      lines.push('', `Invite link (if needed): ${invite}`)
    }
    return ephemeral(lines.join('\n'))
  }

  if (sub === 'disable') {
    try {
      const subRow = await getDiscordRaffleAlertSubscription(guildId)
      if (!subRow || !subRow.enabled) {
        return ephemeral('Raffle alerts were not enabled in this server.')
      }
      await disableDiscordRaffleAlertSubscription(guildId)
    } catch (e) {
      console.error('[owltopia-alerts] disable:', e)
      return ephemeral('Could not disable alerts (database error). Try again in a moment.')
    }
    return ephemeral(`**${PLATFORM_NAME} raffle alerts disabled** for this server.`)
  }

  if (sub === 'status') {
    let subRow
    try {
      subRow = await getDiscordRaffleAlertSubscription(guildId)
    } catch (e) {
      console.error('[owltopia-alerts] status:', e)
      return ephemeral('Could not load alert status (database error).')
    }

    if (!subRow || !subRow.enabled) {
      return ephemeral(
        [
          `**${PLATFORM_NAME} raffle alerts:** off`,
          '',
          'Run `/owltopia-alerts enable channel:#your-channel` to get free posts when new public raffles go live.',
        ].join('\n')
      )
    }

    return ephemeral(
      [
        `**${PLATFORM_NAME} raffle alerts:** on`,
        `**Channel:** <#${subRow.channel_id}>`,
        '',
        'Disable with `/owltopia-alerts disable`.',
      ].join('\n')
    )
  }

  return ephemeral(
    'Unknown subcommand. Use `/owltopia-alerts enable`, `disable`, or `status`.'
  )
}
