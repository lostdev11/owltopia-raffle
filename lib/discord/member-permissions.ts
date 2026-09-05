/** Discord permission bits used for partner / WL tool gates. */
export const DISCORD_ADMINISTRATOR_BIT = 0x8n
export const DISCORD_MANAGE_GUILD_BIT = 0x20n
export const DISCORD_MANAGE_WEBHOOKS_BIT = 1n << 29n

/** Administrator, Manage Server, or Manage Webhooks — enough to look up WL mintlists. */
export function memberHasDiscordPartnerManagePerms(permissions: string | undefined): boolean {
  if (!permissions?.trim()) return false
  try {
    const perms = BigInt(permissions)
    return (
      (perms & DISCORD_ADMINISTRATOR_BIT) !== 0n ||
      (perms & DISCORD_MANAGE_GUILD_BIT) !== 0n ||
      (perms & DISCORD_MANAGE_WEBHOOKS_BIT) !== 0n
    )
  } catch {
    return false
  }
}
