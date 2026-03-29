/**
 * Ensures we only call Discord’s incoming webhook API (HTTPS, official hosts).
 * Blocks SSRF if env is mistyped and avoids posting to arbitrary URLs.
 */
const ALLOWED_HOSTS = new Set([
  'discord.com',
  'canary.discord.com',
  'ptb.discord.com',
  'discordapp.com',
])

export function isAllowedDiscordIncomingWebhookUrl(raw: string): boolean {
  const s = raw.trim()
  if (!s) return false
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  if (!ALLOWED_HOSTS.has(u.hostname.toLowerCase())) return false
  const segments = u.pathname.split('/').filter(Boolean)
  if (segments.length < 4) return false
  if (segments[0] !== 'api' || segments[1] !== 'webhooks') return false
  if (!/^\d+$/.test(segments[2])) return false
  const token = segments[3]
  if (!token || token.length < 16) return false
  return true
}
