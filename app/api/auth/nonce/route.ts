import { NextRequest, NextResponse } from 'next/server'
import { generateNonce, buildSignInMessage } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/nonce?wallet=<address>
 * Returns a nonce and the message the client must sign for SIWS.
 */
export async function GET(request: NextRequest) {
  try {
    const wallet = request.nextUrl.searchParams.get('wallet')?.trim()
    if (!wallet || wallet.length < 32) {
      return NextResponse.json(
        { error: 'Valid wallet address is required' },
        { status: 400 }
      )
    }
    const nonce = generateNonce(wallet)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
    const message = buildSignInMessage(nonce, expiresAt)
    return NextResponse.json({ nonce, message, expiresAt: expiresAt.toISOString() })
  } catch (error) {
    console.error('[auth/nonce]', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
