/**
 * Server-side SIWS (Sign-In with Solana) and session handling.
 * Admin routes should use getSessionFromCookie + isAdmin instead of trusting headers.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { PublicKey } from '@solana/web3.js'
import nacl from 'tweetnacl'
import { getAdminRole, isAdmin } from '@/lib/db/admins'
import { isFullAdminRole } from '@/lib/admin/roles'
import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'

export const SESSION_COOKIE_NAME = 'owl_session'
const NONCE_TTL_MS = 5 * 60 * 1000 // 5 min
const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 h

/** Compact binary nonce (Ledger-friendly message size). */
const NONCE_V2 = 2
const NONCE_V2_BYTES = 25 // version(1) + exp(8) + random(16)

function getSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET or AUTH_SECRET (min 16 chars) required for auth')
  }
  return secret
}

type NoncePayload = { w: string; exp: number; r: string; v: 1 | 2 }

/**
 * Stateless nonce (serverless-safe).
 *
 * v2 is a compact binary token (wallet bound via HMAC) so SIWS messages stay short
 * enough for Ledger clear / blind signing through Phantom and Solflare.
 * Single-use is enforced by {@link consumeNonceOnce} recording the random id in Supabase.
 */
export function generateNonce(wallet: string, expiresAtMs: number): string {
  const secret = getSecret()
  const buf = Buffer.alloc(NONCE_V2_BYTES)
  buf.writeUInt8(NONCE_V2, 0)
  buf.writeBigUInt64BE(BigInt(expiresAtMs), 1)
  randomBytes(16).copy(buf, 9)
  const payloadB64 = buf.toString('base64url')
  const sig = createHmac('sha256', secret)
    .update(`${wallet.trim()}|${payloadB64}`)
    .digest('base64url')
  return `${payloadB64}.${sig}`
}

function parseV2NoncePayload(payloadB64: string, wallet: string): NoncePayload | null {
  const buf = Buffer.from(payloadB64, 'base64url')
  if (buf.length !== NONCE_V2_BYTES || buf.readUInt8(0) !== NONCE_V2) return null
  const exp = Number(buf.readBigUInt64BE(1))
  const r = buf.subarray(9, 25).toString('base64url')
  if (!Number.isFinite(exp) || !r) return null
  if (exp < Date.now()) return null
  if (exp > Date.now() + NONCE_TTL_MS + 30_000) return null
  return { w: wallet.trim(), exp, r, v: 2 }
}

function parseV1NoncePayload(payloadB64: string, wallet: string): NoncePayload | null {
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Partial<{
    w: string
    exp: number
    r: string
    v: number
  }>
  if (payload.v !== 1) return null
  if (typeof payload.w !== 'string' || typeof payload.exp !== 'number' || typeof payload.r !== 'string') {
    return null
  }
  if (!payload.r.trim()) return null
  if (payload.w.trim() !== wallet.trim()) return null
  if (payload.exp < Date.now()) return null
  if (payload.exp > Date.now() + NONCE_TTL_MS + 30_000) return null
  return { w: payload.w, exp: payload.exp, r: payload.r, v: 1 }
}

/** Detect nonce wire format without validating HMAC (for message-shape selection). */
export function peekSignInNonceVersion(nonce: string): 1 | 2 | null {
  const [payloadB64] = (nonce || '').split('.')
  if (!payloadB64) return null
  try {
    const buf = Buffer.from(payloadB64, 'base64url')
    if (buf.length === NONCE_V2_BYTES && buf.readUInt8(0) === NONCE_V2) return 2
  } catch {
    /* fall through */
  }
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as { v?: number }
    if (payload.v === 1) return 1
  } catch {
    /* ignore */
  }
  return null
}

/** Validate HMAC + wallet + expiry; returns payload when valid. */
export function parseValidatedNonce(
  nonce: string,
  wallet: string
): NoncePayload | null {
  const [payloadB64, sigB64] = (nonce || '').split('.')
  if (!payloadB64 || !sigB64) return null
  try {
    const secret = getSecret()
    const got = Buffer.from(sigB64, 'base64url')
    const version = peekSignInNonceVersion(nonce)

    if (version === 2) {
      const expected = createHmac('sha256', secret).update(`${wallet.trim()}|${payloadB64}`).digest()
      if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null
      return parseV2NoncePayload(payloadB64, wallet)
    }

    if (version === 1) {
      const expected = createHmac('sha256', secret).update(payloadB64).digest()
      if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null
      return parseV1NoncePayload(payloadB64, wallet)
    }

    return null
  } catch {
    return null
  }
}

/** HMAC + wallet + expiry check (does not mark single-use). Prefer {@link consumeNonceOnce}. */
export function consumeNonce(nonce: string, wallet: string): boolean {
  return parseValidatedNonce(nonce, wallet) != null
}

/**
 * Validate nonce then consume it once (Supabase insert on nonce random id).
 * Returns false if invalid, expired, or already consumed.
 */
export async function consumeNonceOnce(nonce: string, wallet: string): Promise<boolean> {
  const payload = parseValidatedNonce(nonce, wallet)
  if (!payload) return false

  const { getSupabaseAdmin } = await import('@/lib/supabase-admin')
  const db = getSupabaseAdmin()

  // Opportunistic TTL cleanup (best-effort; ignore failures)
  void db.from('siws_consumed_nonces').delete().lt('expires_at', new Date().toISOString())

  const { error } = await db.from('siws_consumed_nonces').insert({
    nonce_id: payload.r,
    wallet: wallet.trim(),
    expires_at: new Date(payload.exp).toISOString(),
  })

  if (error) {
    // Unique violation — already consumed
    if (error.code === '23505') return false
    console.error('[auth] consumeNonceOnce:', error.message)
    return false
  }
  return true
}

function signInSiteHost(): string {
  try {
    return new URL(getSiteBaseUrl()).host
  } catch {
    return 'www.owltopia.xyz'
  }
}

function formatSignInExpiry(expiresAt: Date): string {
  return (
    expiresAt.toLocaleString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' UTC'
  )
}

/** Extract nonce from any SIWS message we have issued (current or legacy format). */
export function parseNonceFromSignInMessage(message: string): string | null {
  const match = message.match(/(?:^|\n)Nonce:\s*([^\n]+)/i)
  return match?.[1]?.trim() ?? null
}

/**
 * Compact printable-ASCII SIWS message for Ledger / hardware wallets.
 * Keeps payload well under Solana off-chain HW limits (~1212 bytes).
 */
export function buildCompactSignInMessage(wallet: string, nonce: string, expiresAt: Date): string {
  const host = signInSiteHost()
  return [
    `${host} wallet verify`,
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Exp: ${expiresAt.getTime()}`,
  ].join('\n')
}

/** Legacy verbose SIWS message (v1 nonces still in flight during deploy). */
export function buildLegacySignInMessage(wallet: string, nonce: string, expiresAt: Date): string {
  const host = signInSiteHost()
  return [
    `Verify wallet for ${host}`,
    '',
    `This proves you control the wallet below. ${PLATFORM_NAME} will not charge fees or send a transaction from this signature.`,
    '',
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Valid until: ${formatSignInExpiry(expiresAt)}`,
  ].join('\n')
}

export function buildSignInMessage(wallet: string, nonce: string, expiresAt: Date): string {
  const version = peekSignInNonceVersion(nonce)
  if (version === 1) return buildLegacySignInMessage(wallet, nonce, expiresAt)
  return buildCompactSignInMessage(wallet, nonce, expiresAt)
}

/**
 * Require the signed message to match the exact SIWS text we issue for this wallet + nonce
 * (host, wallet line, expiry from the nonce). Rejects shape/host/wallet mismatches.
 */
export function messageMatchesIssuedSignIn(wallet: string, message: string, nonce: string): boolean {
  const payload = parseValidatedNonce(nonce, wallet)
  if (!payload) return false
  const expected = buildSignInMessage(wallet, nonce, new Date(payload.exp))
  if (message.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(message, 'utf8'), Buffer.from(expected, 'utf8'))
  } catch {
    return false
  }
}

/** Approximate UTF-8 byte length of a freshly issued SIWS message (for Ledger diagnostics). */
export function measureSignInMessageBytes(wallet: string, expiresAtMs = Date.now() + NONCE_TTL_MS): number {
  const nonce = generateNonce(wallet, expiresAtMs)
  return Buffer.byteLength(buildSignInMessage(wallet, nonce, new Date(expiresAtMs)), 'utf8')
}

/**
 * Verify SIWS: message was signed by the wallet's private key.
 * signatureBase64: base64-encoded signature (client sends from signMessage).
 */
export function verifySignIn(
  wallet: string,
  message: string,
  signatureBase64: string
): { valid: boolean; error?: string } {
  try {
    const publicKey = new PublicKey(wallet)
    const messageBytes = new TextEncoder().encode(message)
    const signature = Buffer.from(signatureBase64, 'base64')
    if (signature.length !== 64) {
      return { valid: false, error: 'Invalid signature length' }
    }
    const verified = nacl.sign.detached.verify(
      messageBytes,
      signature,
      publicKey.toBytes()
    )
    return verified ? { valid: true } : { valid: false, error: 'Invalid signature' }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    return { valid: false, error: err }
  }
}

export function createSessionCookie(wallet: string): string {
  const secret = getSecret()
  const exp = Date.now() + SESSION_TTL_MS
  const payload = JSON.stringify({ wallet, exp })
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  const value = `${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`
  return value
}

/** Split `Cookie` header into name=value (handles quoted values; avoids brittle regex on base64url). */
function extractCookieRawValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader?.trim()) return null
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=')
    if (idx <= 0) continue
    const k = part.slice(0, idx).trim()
    if (k !== name) continue
    let v = part.slice(idx + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1).trim()
    }
    return v || null
  }
  return null
}

function verifySignedSessionToken(token: string): { wallet: string } | null {
  try {
    const secret = getSecret()
    const [payloadB64, sigB64] = token.split('.')
    if (!payloadB64 || !sigB64) return null
    const payload = Buffer.from(payloadB64, 'base64url').toString('utf8')
    const expectedSigBuf = createHmac('sha256', secret).update(payload).digest()
    const sigBuf = Buffer.from(sigB64, 'base64url')
    if (expectedSigBuf.length !== sigBuf.length || !timingSafeEqual(expectedSigBuf, sigBuf)) {
      return null
    }
    const { wallet, exp } = JSON.parse(payload) as { wallet?: string; exp?: number }
    if (!wallet || typeof exp !== 'number' || exp < Date.now()) return null
    return { wallet }
  } catch {
    return null
  }
}

/** Validate `owl_session` cookie value (raw token only). */
export function decodeSessionCookieValue(raw: string): { wallet: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const unquoted = trimmed.replace(/^["']|["']$/g, '').trim()
  const candidates = [trimmed, unquoted]
  try {
    const dec = decodeURIComponent(unquoted)
    if (dec !== unquoted) candidates.push(dec)
  } catch {
    // ignore
  }
  for (const c of candidates) {
    const s = verifySignedSessionToken(c)
    if (s) return s
  }
  return null
}

export function parseSessionCookie(cookieHeader: string | null): { wallet: string } | null {
  const value = extractCookieRawValue(cookieHeader, SESSION_COOKIE_NAME)
  if (!value) return null
  return decodeSessionCookieValue(value)
}

export function getSessionFromRequest(request: NextRequest): { wallet: string } | null {
  const fromNext = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (fromNext) {
    const s = decodeSessionCookieValue(fromNext)
    if (s) return s
  }
  return parseSessionCookie(request.headers.get('cookie'))
}

/** Parse session from cookie value (for server components that use cookies() from next/headers). */
export function parseSessionCookieValue(value: string | undefined): { wallet: string } | null {
  if (!value?.trim()) return null
  return decodeSessionCookieValue(value)
}

/**
 * Use when any signed-in wallet is required (e.g. user dashboard).
 * Returns 401 if not signed in, otherwise the session wallet.
 */
export async function requireSession(
  request: NextRequest
): Promise<{ wallet: string } | NextResponse> {
  const session = getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json(
      {
        error:
          'Sign in required. Use Sign in on this page with the same browser tab (in-app wallet browsers do not share cookies with Safari/Chrome).',
      },
      { status: 401 }
    )
  }
  return session
}

/**
 * Use in admin routes that any Owl Vision role may call (`mod` or `full`).
 * Returns 401/403 or the admin wallet.
 */
export async function requireAdminSession(
  request: NextRequest
): Promise<{ wallet: string } | NextResponse> {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session
  const admin = await isAdmin(session.wallet)
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return session
}

/**
 * Full Owl Vision only — refunds, winners, prize moves, nesting heal, treasury, irreversible ops.
 * Junior `mod` sessions receive 403.
 */
export async function requireFullAdminSession(
  request: NextRequest
): Promise<{ wallet: string } | NextResponse> {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session
  const role = await getAdminRole(session.wallet)
  if (!isFullAdminRole(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return session
}

export function setSessionCookieInResponse(response: NextResponse, wallet: string): void {
  const value = createSessionCookie(wallet)
  response.cookies.set(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    path: '/',
  })
}
