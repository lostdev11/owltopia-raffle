import { NextResponse } from 'next/server'
import { getOwlSwapEscrowPublicKey } from '@/lib/owl-swap/escrow'

export const dynamic = 'force-dynamic'

/** GET /api/owl-swap/escrow — public escrow deposit address. */
export async function GET() {
  const address = getOwlSwapEscrowPublicKey()
  if (!address) {
    return NextResponse.json(
      { error: 'OwlSwap escrow is not configured (OWL_SWAP_ESCROW_SECRET_KEY).' },
      { status: 503 }
    )
  }
  return NextResponse.json({ address })
}
