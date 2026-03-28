import { NextResponse } from 'next/server'
import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'

export const dynamic = 'force-dynamic'

/**
 * GET /api/config/funds-escrow
 * Public pubkey for ticket proceeds escrow when FUNDS_ESCROW_SECRET_KEY is set.
 */
export async function GET() {
  const address = getFundsEscrowPublicKey()
  if (!address) {
    return NextResponse.json(
      { error: 'Funds escrow is not configured' },
      { status: 503 }
    )
  }
  return NextResponse.json({ address })
}
