import { NextRequest, NextResponse } from 'next/server'

import { requireSession } from '@/lib/auth-server'
import { getEntriesByWallet } from '@/lib/db/entries'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/entries/my
 * SIWS session required — returns entries only for the signed-in wallet (ignores query/body wallets).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const wallet = normalizeSolanaWalletAddress(session.wallet)
    if (!wallet) {
      return NextResponse.json({ error: 'Invalid session wallet' }, { status: 401 })
    }

    const entriesWithRaffles = await getEntriesByWallet(wallet)

    return NextResponse.json(entriesWithRaffles, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    })
  } catch (error) {
    console.error('Error fetching my entries:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
