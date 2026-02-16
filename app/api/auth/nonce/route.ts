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
    
    // Check if SESSION_SECRET is available before proceeding
    const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET
    if (!secret || secret.length < 16) {
      console.error('[auth/nonce] SESSION_SECRET or AUTH_SECRET missing or too short')
      console.error('[auth/nonce] NODE_ENV:', process.env.NODE_ENV)
      console.error('[auth/nonce] Available env vars:', Object.keys(process.env).filter(k => k.includes('SESSION') || k.includes('AUTH')))
      
      const isDev = process.env.NODE_ENV === 'development'
      const errorMessage = isDev
        ? 'Server configuration error: SESSION_SECRET or AUTH_SECRET not found. Please ensure .env.local exists with SESSION_SECRET set (min 16 chars) and restart your dev server.'
        : 'Server configuration error: authentication secret not configured. Please set SESSION_SECRET or AUTH_SECRET in your hosting platform\'s environment variables.'
      
      return NextResponse.json(
        { error: errorMessage },
        { status: 500 }
      )
    }
    
    const nonce = generateNonce(wallet)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
    const message = buildSignInMessage(nonce, expiresAt)
    return NextResponse.json({ nonce, message, expiresAt: expiresAt.toISOString() })
  } catch (error) {
    console.error('[auth/nonce] Error:', error instanceof Error ? error.message : String(error))
    if (error instanceof Error && error.stack) {
      console.error('[auth/nonce] Stack:', error.stack)
    }
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
