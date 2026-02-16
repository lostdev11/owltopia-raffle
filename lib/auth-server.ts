/**
 * Server-side SIWS (Sign-In with Solana) and session handling.
 * Admin routes should use getSessionFromCookie + isAdmin instead of trusting headers.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { PublicKey } from '@solana/web3.js'
import nacl from 'tweetnacl'
import { isAdmin } from '@/lib/db/admins'

export const SESSION_COOKIE_NAME = 'owl_session'
const NONCE_TTL_MS = 5 * 60 * 1000 // 5 min
const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 h

const nonceStore = new Map<string, { expiresAt: number }>()

function getSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET or AUTH_SECRET (min 16 chars) required for auth')
  }
  return secret
}

export function generateNonce(wallet: string): string {
  const secret = getSecret()
  const nonce = createHmac('sha256', secret)
    .update(`${wallet}:${Date.now()}:${Math.random()}`)
    .digest('hex')
    .slice(0, 32)
  nonceStore.set(nonce, { expiresAt: Date.now() + NONCE_TTL_MS })
  return nonce
}

export function consumeNonce(nonce: string): boolean {
  const entry = nonceStore.get(nonce)
  if (!entry || entry.expiresAt < Date.now()) return false
  nonceStore.delete(nonce)
  return true
}

const MESSAGE_PREFIX = 'Sign in to Owl Raffle.\nNonce: '
const MESSAGE_SUFFIX = '\nExpires: '

export function buildSignInMessage(nonce: string, expiresAt: Date): string {
  return `${MESSAGE_PREFIX}${nonce}${MESSAGE_SUFFIX}${expiresAt.toISOString()}`
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

export function parseSessionCookie(cookieHeader: string | null): { wallet: string } | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`))
  const value = match?.[1]?.trim()
  if (!value) return null
  try {
    const secret = getSecret()
    const [payloadB64, sigB64] = value.split('.')
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

export function getSessionFromRequest(request: NextRequest): { wallet: string } | null {
  const cookie = request.headers.get('cookie')
  return parseSessionCookie(cookie)
}

/**
 * Use in admin routes: returns 401/403 response or the admin wallet.
 */
export async function requireAdminSession(
  request: NextRequest
): Promise<{ wallet: string } | NextResponse> {
  const session = getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json(
      { error: 'Sign in required. Use SIWS (Sign-In with Solana) and session cookie.' },
      { status: 401 }
    )
  }
  const admin = await isAdmin(session.wallet)
  if (!admin) {
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
