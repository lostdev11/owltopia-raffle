import { NextRequest, NextResponse } from 'next/server'
import {
  consumeNonceOnce,
  messageMatchesIssuedSignIn,
  parseNonceFromSignInMessage,
  setSessionCookieInResponse,
} from '@/lib/auth-server'
import { verifySignInMemoTransaction } from '@/lib/auth-tx-sign-in'
import { authVerifyTxBody } from '@/lib/validations'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { syncReferralStateForWallet } from '@/lib/db/referrals'

export const dynamic = 'force-dynamic'

const VERIFY_IP_LIMIT = 40
const VERIFY_WALLET_LIMIT = 20
const VERIFY_WINDOW_MS = 60_000

/**
 * POST /api/auth/verify-tx
 * Body: { wallet, message, signedTransaction } — Ledger / hardware fallback when
 * off-chain signMessage never reaches the device through Phantom/Solflare.
 * The memo transaction is verified locally and is not broadcast.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const ipRl = rateLimit(`auth-verify-tx:ip:${ip}`, VERIFY_IP_LIMIT, VERIFY_WINDOW_MS)
    if (!ipRl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const body = await request.json().catch(() => ({}))
    const parsed = authVerifyTxBody.safeParse(body)
    if (!parsed.success) {
      const msg = parsed.error.flatten().fieldErrors
      const err = Object.entries(msg)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('; ')
      return NextResponse.json({ error: err || 'Invalid request' }, { status: 400 })
    }
    const { wallet: walletStr, message: messageStr, signedTransaction } = parsed.data

    const walletRl = rateLimit(`auth-verify-tx:wallet:${walletStr}`, VERIFY_WALLET_LIMIT, VERIFY_WINDOW_MS)
    if (!walletRl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const nonce = parseNonceFromSignInMessage(messageStr)
    if (!nonce || !messageMatchesIssuedSignIn(walletStr, messageStr, nonce)) {
      return NextResponse.json({ error: 'Invalid sign-in message' }, { status: 400 })
    }

    const result = verifySignInMemoTransaction({
      wallet: walletStr,
      message: messageStr,
      signedTransactionBase64: signedTransaction,
    })
    if (!result.valid) {
      return NextResponse.json(
        { error: result.error || 'Invalid signed transaction' },
        { status: 400 }
      )
    }

    if (!(await consumeNonceOnce(nonce, walletStr))) {
      return NextResponse.json({ error: 'Invalid or expired nonce' }, { status: 400 })
    }

    const response = NextResponse.json({ ok: true, method: 'tx-memo' })
    setSessionCookieInResponse(response, walletStr)
    try {
      await syncReferralStateForWallet(walletStr)
    } catch (e) {
      console.error('[auth/verify-tx] referral sync:', e instanceof Error ? e.message : e)
    }
    return response
  } catch (error) {
    console.error('[auth/verify-tx]', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
