import { NextResponse } from 'next/server'
import { getPrizeEscrowPublicKey } from '@/lib/raffles/prize-escrow'

export const dynamic = 'force-dynamic'

/**
 * GET /api/config/prize-escrow
 * Returns the public key of the prize escrow wallet so creators know where to send NFT prizes.
 * Returns 503 if prize escrow is not configured.
 */
export async function GET() {
  const address = getPrizeEscrowPublicKey()
  if (!address) {
    return NextResponse.json(
      { error: 'Prize escrow is not configured' },
      { status: 503 }
    )
  }
  return NextResponse.json({ address })
}
