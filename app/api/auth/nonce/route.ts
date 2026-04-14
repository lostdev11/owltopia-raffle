import { NextRequest, NextResponse } from 'next/server'
import { generateNonce, buildSignInMessage } from '@/lib/auth-server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const NONCE_IP_LIMIT = 45
const NONCE_WALLET_LIMIT = 25
const NONCE_WINDOW_MS = 60_000

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

    const ip = getClientIp(request)
    const ipRl = rateLimit(`auth-nonce:ip:${ip}`, NONCE_IP_LIMIT, NONCE_WINDOW_MS)
    if (!ipRl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }
    const walletRl = rateLimit(`auth-nonce:wallet:${wallet}`, NONCE_WALLET_LIMIT, NONCE_WINDOW_MS)
    if (!walletRl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    // Check if SESSION_SECRET is available before proceeding
    const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET
    if (!secret || secret.length < 16) {
      console.error('[auth/nonce] SESSION_SECRET or AUTH_SECRET missing or too short')

      const isDev = process.env.NODE_ENV === 'development'
      const errorMessage = isDev
        ? 'Server configuration error: SESSION_SECRET or AUTH_SECRET not found. Please ensure .env.local exists with SESSION_SECRET set (min 16 chars) and restart your dev server.'
        : 'Server configuration error: authentication secret not configured. Please set SESSION_SECRET or AUTH_SECRET in your hosting platform\'s environment variables.'
      
      return NextResponse.json(
        { error: errorMessage },
        { status: 500 }
      )
    }
    
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
    const nonce = generateNonce(wallet, expiresAt.getTime())
    const message = buildSignInMessage(nonce, expiresAt)
    return NextResponse.json({ nonce, message, expiresAt: expiresAt.toISOString() })
  } catch (error) {
    console.error('[auth/nonce]', error instanceof Error ? error.message : String(error))
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
