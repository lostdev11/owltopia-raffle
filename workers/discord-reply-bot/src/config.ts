import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export type ReplyBotConfig = {
  token: string
  guildId: string
  channelIds: string[] | null
  siteUrl: string
  enabled: boolean
  cooldownSec: number
  port: number
}

function loadDotenvLocal(): void {
  if (process.env.DISCORD_BOT_TOKEN?.trim()) return
  const candidates = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '../../.env.local'),
  ]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      applyEnvFile(readFileSync(path, 'utf8'))
    } catch {
      /* ignore */
    }
    return
  }
}

function applyEnvFile(text: string): void {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = val
    }
  }
}

export function loadConfig(): ReplyBotConfig {
  loadDotenvLocal()

  const token = process.env.DISCORD_BOT_TOKEN?.trim() ?? ''
  const guildId = process.env.DISCORD_GUILD_ID?.trim() ?? ''
  if (!token) throw new Error('DISCORD_BOT_TOKEN is required')
  if (!guildId) throw new Error('DISCORD_GUILD_ID is required')

  const channelRaw = process.env.DISCORD_REPLY_CHANNEL_IDS?.trim()
  const channelIds = channelRaw
    ? channelRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null

  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.OWLTOPIA_SITE_URL ??
    'https://www.owltopia.xyz'
  )
    .trim()
    .replace(/\/$/, '')

  const enabled = process.env.DISCORD_REPLY_ENABLED !== 'false'
  const cooldownSec = Math.max(
    5,
    Number.parseInt(process.env.DISCORD_REPLY_COOLDOWN_SEC ?? '30', 10) || 30
  )
  const port = Math.max(1, Number.parseInt(process.env.PORT ?? '8080', 10) || 8080)

  return { token, guildId, channelIds, siteUrl, enabled, cooldownSec, port }
}
