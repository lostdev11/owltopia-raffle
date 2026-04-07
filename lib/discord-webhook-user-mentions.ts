/**
 * Helpers for Discord incoming webhooks: user mentions require `allowed_mentions.users`
 * when not using default parse modes.
 */

/** Discord snowflake user id (numeric string; length varies). */
export function parseDiscordUserSnowflake(raw: string | null | undefined): string | null {
  const t = raw?.trim() ?? ''
  if (!t || !/^\d{15,40}$/.test(t)) return null
  return t
}

export function allowedMentionsForUserIds(userIds: string[]): { parse: []; users: string[] } | undefined {
  const users = [...new Set(userIds.map((id) => parseDiscordUserSnowflake(id)).filter(Boolean))] as string[]
  if (users.length === 0) return undefined
  return { parse: [], users }
}
