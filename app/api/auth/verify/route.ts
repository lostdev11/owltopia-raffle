import { NextRequest, NextResponse } from 'next/server'
import {
  consumeNonceOnce,
  messageMatchesIssuedSignIn,
  parseNonceFromSignInMessage,
  verifySignIn,
  setSessionCookieInResponse,
} from '@/lib/auth-server'
import { authVerifyBody } from '@/lib/validations'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { syncReferralStateForWallet } from '@/lib/db/referrals'

export const dynamic = 'force-dynamic'

const VERIFY_IP_LIMIT = 40
const VERIFY_WALLET_LIMIT = 20
const VERIFY_WINDOW_MS = 60_000

/**
 * POST /api/auth/verify
 * Body: { wallet, message, signature } (signature = base64 from signMessage)
 * Verifies SIWS and sets an httpOnly session cookie for that wallet (any holder — not admin-only).
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const ipRl = rateLimit(`auth-verify:ip:${ip}`, VERIFY_IP_LIMIT, VERIFY_WINDOW_MS)
    if (!ipRl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const body = await request.json().catch(() => ({}))
    const parsed = authVerifyBody.safeParse(body)
    if (!parsed.success) {
      const msg = parsed.error.flatten().fieldErrors
      const err = Object.entries(msg).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ')
      return NextResponse.json({ error: err || 'Invalid request' }, { status: 400 })
    }
    const { wallet: walletStr, message: messageStr, signature: sigStr } = parsed.data

    const walletRl = rateLimit(`auth-verify:wallet:${walletStr}`, VERIFY_WALLET_LIMIT, VERIFY_WINDOW_MS)
    if (!walletRl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const nonce = parseNonceFromSignInMessage(messageStr)
    if (!nonce || !messageMatchesIssuedSignIn(walletStr, messageStr, nonce)) {
      return NextResponse.json(
        { error: 'Invalid sign-in message' },
        { status: 400 }
      )
    }

    const result = verifySignIn(walletStr, messageStr, sigStr)
    if (!result.valid) {
      return NextResponse.json(
        { error: result.error || 'Invalid signature' },
        { status: 400 }
      )
    }

    // Consume after signature check so a bad signature does not burn the nonce.
    if (!(await consumeNonceOnce(nonce, walletStr))) {
      return NextResponse.json(
        { error: 'Invalid or expired nonce' },
        { status: 400 }
      )
    }

    const response = NextResponse.json({ ok: true })
    setSessionCookieInResponse(response, walletStr)
    try {
      await syncReferralStateForWallet(walletStr)
    } catch (e) {
      console.error('[auth/verify] referral sync:', e instanceof Error ? e.message : e)
    }
    return response
  } catch (error) {
    // Don't log full error object which might contain wallet addresses
    console.error('[auth/verify]', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
