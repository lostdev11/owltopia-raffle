import { NextRequest, NextResponse } from 'next/server'

import { getSessionFromRequest } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/wallet-session
 * Returns Owltopia SIWS wallet from httpOnly cookie (no admin check).
 */
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request)
  return NextResponse.json({ wallet: session?.wallet ?? null })
}
