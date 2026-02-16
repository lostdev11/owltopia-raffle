import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/session
 * Returns current admin session if cookie is valid. Used by admin UI to know if SIWS is needed.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session
    return NextResponse.json({ wallet: session.wallet })
  } catch (error) {
    // Don't log full error object which might contain wallet addresses
    console.error('[auth/session]', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
