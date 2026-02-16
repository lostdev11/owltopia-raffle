import { NextRequest, NextResponse } from 'next/server'
import { consumeNonce, verifySignIn, setSessionCookieInResponse } from '@/lib/auth-server'
import { isAdmin } from '@/lib/db/admins'
import { authVerifyBody } from '@/lib/validations'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/verify
 * Body: { wallet, message, signature } (signature = base64 from signMessage)
 * Verifies SIWS and sets httpOnly session cookie if wallet is admin.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const parsed = authVerifyBody.safeParse(body)
    if (!parsed.success) {
      const msg = parsed.error.flatten().fieldErrors
      const err = Object.entries(msg).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ')
      return NextResponse.json({ error: err || 'Invalid request' }, { status: 400 })
    }
    const { wallet: walletStr, message: messageStr, signature: sigStr } = parsed.data

    const nonceMatch = messageStr.match(/Nonce: ([^\n]+)/)
    const nonce = nonceMatch?.[1]?.trim()
    if (!nonce || !consumeNonce(nonce)) {
      return NextResponse.json(
        { error: 'Invalid or expired nonce' },
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

    const admin = await isAdmin(walletStr)
    if (!admin) {
      return NextResponse.json(
        { error: 'Wallet is not an admin' },
        { status: 403 }
      )
    }

    const response = NextResponse.json({ ok: true })
    setSessionCookieInResponse(response, walletStr)
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
