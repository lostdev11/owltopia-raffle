/**
 * Assign Discord guild roles via bot token (server-side only).
 */
const DISCORD_API = 'https://discord.com/api/v10'

export type DiscordGuildRoleAssignResult =
  | { ok: true }
  | { ok: false; code: 'not_configured' | 'not_in_guild' | 'forbidden' | 'api_error'; message: string }

function getDiscordBotConfig(): { token: string; guildId: string } | null {
  const token = process.env.DISCORD_BOT_TOKEN?.trim()
  const guildId = process.env.DISCORD_GUILD_ID?.trim()
  if (!token || !guildId) return null
  return { token, guildId }
}

export function getGen2PresaleDiscordRoleId(): string | null {
  return process.env.DISCORD_GEN2_PRESALE_ROLE_ID?.trim() || null
}

export function getDiscordRoleIdForGen2RoleType(roleType: 'gen2_presale' | 'gen2_whitelist'): string | null {
  if (roleType === 'gen2_presale') {
    return getGen2PresaleDiscordRoleId()
  }
  const whitelistRole = process.env.DISCORD_GEN2_WHITELIST_ROLE_ID?.trim()
  return whitelistRole || getGen2PresaleDiscordRoleId()
}

/**
 * PUT /guilds/{guild.id}/members/{user.id}/roles/{role.id}
 * User must already be in the guild.
 */
export async function assignDiscordGuildRole(
  discordUserId: string,
  roleId: string
): Promise<DiscordGuildRoleAssignResult> {
  const cfg = getDiscordBotConfig()
  if (!cfg) {
    return { ok: false, code: 'not_configured', message: 'Discord bot or guild is not configured.' }
  }

  const userId = discordUserId.trim()
  const rid = roleId.trim()
  if (!userId || !rid) {
    return { ok: false, code: 'api_error', message: 'Invalid Discord user or role id.' }
  }

  const url = `${DISCORD_API}/guilds/${cfg.guildId}/members/${userId}/roles/${rid}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bot ${cfg.token}` },
  })

  if (res.status === 204 || res.status === 201) {
    return { ok: true }
  }

  const text = await res.text().catch(() => '')

  if (res.status === 404) {
    return {
      ok: false,
      code: 'not_in_guild',
      message:
        'Your Discord account is not in the Owltopia server yet. Join the server first, then try again.',
    }
  }

  if (res.status === 403) {
    return {
      ok: false,
      code: 'forbidden',
      message:
        'The bot could not assign this role. Check bot permissions and that the role is below the bot role in Discord.',
    }
  }

  console.error('[discord-guild-roles] assign failed', res.status, text.slice(0, 400))
  return {
    ok: false,
    code: 'api_error',
    message: 'Discord could not assign the role. Try again in a few minutes.',
  }
}
