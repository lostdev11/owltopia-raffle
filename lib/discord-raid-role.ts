/**
 * Owltopia Discord @raid role pings (server-side only).
 * Use `<@&roleId>` in content and `allowed_mentions.roles` so Discord delivers the ping.
 */

/** Default Owltopia @raid role (Gembird, May 2026). Override with DISCORD_RAID_ROLE_ID. */
export const DEFAULT_DISCORD_RAID_ROLE_ID = '1458816019282919569'

export function getDiscordRaidRoleId(): string | null {
  const raw = process.env.DISCORD_RAID_ROLE_ID?.trim() || DEFAULT_DISCORD_RAID_ROLE_ID
  if (!/^\d{17,20}$/.test(raw)) return null
  return raw
}

export function formatDiscordRaidRoleMention(): string {
  const id = getDiscordRaidRoleId()
  return id ? `<@&${id}> ` : ''
}

export type DiscordRaidRoleAllowedMentions = { parse: []; roles: string[] }

export type DiscordWebhookContentAllowedMentions =
  | DiscordRaidRoleAllowedMentions
  | { parse: ('everyone' | 'roles' | 'users')[]; users?: string[]; roles?: string[] }

export function allowedMentionsForRaidRole(): DiscordRaidRoleAllowedMentions | undefined {
  const id = getDiscordRaidRoleId()
  if (!id) return undefined
  return { parse: [], roles: [id] }
}
