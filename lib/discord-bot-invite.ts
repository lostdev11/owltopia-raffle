/**
 * Canonical Owltopia Discord bot invite (bot + slash commands).
 * Bare `?client_id=` links do NOT add the bot member — always include scope=bot.
 */
export const DISCORD_BOT_INVITE_PERMISSIONS = '2147503104' // View Channel + Send Messages + Embed Links + Use Application Commands

export function buildDiscordBotInviteUrl(applicationId: string): string {
  const appId = applicationId.trim()
  return (
    `https://discord.com/api/oauth2/authorize` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&permissions=${DISCORD_BOT_INVITE_PERMISSIONS}` +
    `&scope=${encodeURIComponent('bot applications.commands')}`
  )
}

/** Prefer DISCORD_BOT_INVITE_URL; else build from DISCORD_APPLICATION_ID. */
export function getDiscordBotInviteUrl(): string | null {
  const custom = process.env.DISCORD_BOT_INVITE_URL?.trim()
  if (custom) return custom
  const appId = process.env.DISCORD_APPLICATION_ID?.trim()
  if (!appId) return null
  return buildDiscordBotInviteUrl(appId)
}
