import { NextRequest, NextResponse } from 'next/server'
import { getEntriesByWallet } from '@/lib/db/entries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/entries/my?wallet=<address>
 * Returns only entries for the given wallet (user's own entries).
 * Each item includes entry + raffle info and blockchain validation (transaction_signature, status).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const wallet = searchParams.get('wallet')?.trim() ?? request.headers.get('x-wallet-address')?.trim()

    if (!wallet) {
      return NextResponse.json(
        { error: 'Missing wallet. Provide ?wallet=<address> or header x-wallet-address.' },
        { status: 400 }
      )
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
