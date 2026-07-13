/**
 * Signed state for Discord-first wallet linking (bot → web connect flow).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const LINK_STATE_TTL_MS = 30 * 60 * 1000

type MarketplaceLinkStatePayload = {
  d: string
  exp: number
  r: string
  v: 1
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET or AUTH_SECRET required for marketplace link state')
  }
  return secret
}

export function generateDiscordMarketplaceLinkState(discordUserId: string): string {
  const did = discordUserId.trim()
  if (!did) throw new Error('discord user id required')
  const secret = getSecret()
  const payload: MarketplaceLinkStatePayload = {
    d: did,
    exp: Date.now() + LINK_STATE_TTL_MS,
    r: `${Date.now()}:${Math.random()}`,
    v: 1,
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url')
  return `${payloadB64}.${sig}`
}

export function parseDiscordMarketplaceLinkState(
  state: string
): { ok: true; discordUserId: string } | { ok: false } {
  const [payloadB64, sigB64] = (state || '').split('.')
  if (!payloadB64 || !sigB64) return { ok: false }
  try {
    const secret = getSecret()
    const expected = createHmac('sha256', secret).update(payloadB64).digest()
    const got = Buffer.from(sigB64, 'base64url')
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return { ok: false }

    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as Partial<MarketplaceLinkStatePayload>
    if (payload.v !== 1) return { ok: false }
    if (typeof payload.d !== 'string' || typeof payload.exp !== 'number') return { ok: false }
    if (payload.exp < Date.now()) return { ok: false }
    const did = payload.d.trim()
    if (!did) return { ok: false }
    return { ok: true, discordUserId: did }
  } catch {
    return { ok: false }
  }
}
