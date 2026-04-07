/**
 * Discord OAuth2 (identify) for linking a Discord user to a wallet profile.
 * Requires DISCORD_OAUTH_CLIENT_SECRET and DISCORD_OAUTH_CLIENT_ID or DISCORD_APPLICATION_ID.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getSiteBaseUrl } from '@/lib/site-config'

const DISCORD_API = 'https://discord.com/api/v10'
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

function getOAuthSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET or AUTH_SECRET (min 16 chars) required for Discord OAuth state')
  }
  return secret
}

type OAuthStatePayload = { w: string; exp: number; r: string; v: 1 }

export function generateDiscordOAuthState(wallet: string): string {
  const secret = getOAuthSecret()
  const payload: OAuthStatePayload = {
    w: wallet.trim(),
    exp: Date.now() + OAUTH_STATE_TTL_MS,
    r: `${Date.now()}:${Math.random()}`,
    v: 1,
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url')
  return `${payloadB64}.${sig}`
}

export function verifyDiscordOAuthState(state: string, expectedWallet: string): boolean {
  const [payloadB64, sigB64] = (state || '').split('.')
  if (!payloadB64 || !sigB64) return false
  try {
    const secret = getOAuthSecret()
    const expected = createHmac('sha256', secret).update(payloadB64).digest()
    const got = Buffer.from(sigB64, 'base64url')
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return false

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Partial<OAuthStatePayload>
    if (payload.v !== 1) return false
    if (typeof payload.w !== 'string' || typeof payload.exp !== 'number') return false
    if (payload.w.trim() !== expectedWallet.trim()) return false
    if (payload.exp < Date.now()) return false
    return true
  } catch {
    return false
  }
}

export function getDiscordOAuthClientId(): string | null {
  const id =
    process.env.DISCORD_OAUTH_CLIENT_ID?.trim() || process.env.DISCORD_APPLICATION_ID?.trim()
  return id || null
}

export function getDiscordOAuthClientSecret(): string | null {
  return process.env.DISCORD_OAUTH_CLIENT_SECRET?.trim() || null
}

/** Must match the redirect URL configured in the Discord Developer Portal for this app. */
export function getDiscordOAuthRedirectUri(): string {
  const explicit = process.env.DISCORD_OAUTH_REDIRECT_URI?.trim()
  if (explicit) return explicit
  const base = getSiteBaseUrl()
  return `${base}/api/me/discord/callback`
}

export function getDiscordOAuthAuthorizeUrl(state: string): string | null {
  const clientId = getDiscordOAuthClientId()
  if (!clientId) return null
  const redirectUri = getDiscordOAuthRedirectUri()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'consent',
  })
  return `https://discord.com/oauth2/authorize?${params.toString()}`
}

export async function exchangeDiscordOAuthCode(code: string): Promise<{ access_token: string } | null> {
  const clientId = getDiscordOAuthClientId()
  const clientSecret = getDiscordOAuthClientSecret()
  if (!clientId || !clientSecret) return null

  const redirectUri = getDiscordOAuthRedirectUri()
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code: code.trim(),
    redirect_uri: redirectUri,
  })

  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[discord-oauth] token exchange failed', res.status, text.slice(0, 400))
    return null
  }
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token?.trim()) return null
  return { access_token: json.access_token.trim() }
}

export type DiscordUserMe = {
  id: string
  username: string
  global_name: string | null
  discriminator?: string
}

export async function fetchDiscordUserMe(accessToken: string): Promise<DiscordUserMe | null> {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken.trim()}` },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[discord-oauth] @me failed', res.status, text.slice(0, 400))
    return null
  }
  const json = (await res.json()) as Partial<DiscordUserMe>
  if (!json.id || !json.username) return null
  return {
    id: String(json.id),
    username: String(json.username),
    global_name: json.global_name != null ? String(json.global_name) : null,
  }
}

export function formatDiscordDisplayName(me: DiscordUserMe): string {
  const g = me.global_name?.trim()
  if (g) return g.slice(0, 64)
  return me.username.trim().slice(0, 64)
}
