import { NextRequest, NextResponse } from 'next/server'
import { getAdminRole } from '@/lib/db/admins'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

// Force dynamic rendering since we use searchParams
export const dynamic = 'force-dynamic'

// Solana base58 address format (32–44 chars)
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`admin-check:${ip}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const raw = searchParams.get('wallet')
    const walletAddress = raw?.trim() ?? ''

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 400 }
      )
    }

    if (!SOLANA_ADDRESS_REGEX.test(walletAddress)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      )
    }

    const role = await getAdminRole(walletAddress)
    const isAdmin = role !== null

    return NextResponse.json({
      isAdmin,
      role: isAdmin ? role : undefined,
    })
  } catch (error) {
    console.error('Error checking admin status:', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
