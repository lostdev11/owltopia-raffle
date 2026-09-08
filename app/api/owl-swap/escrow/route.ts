import { NextResponse } from 'next/server'
import { getOwlSwapEscrowPublicKey } from '@/lib/owl-swap/escrow'
import { isOwlSwapSimulateEnabled } from '@/lib/owl-swap/simulate'

export const dynamic = 'force-dynamic'

/**
 * GET /api/owl-swap/escrow
 * Returns deposit address when configured.
 * When admin-only simulate is on (no escrow key), returns 200 with simulate:true
 * so the UI can run create/accept without on-chain deposits.
 */
export async function GET() {
  const address = getOwlSwapEscrowPublicKey()
  const simulate = isOwlSwapSimulateEnabled()

  if (address) {
    return NextResponse.json({
      address,
      simulate: false,
      mode: 'live',
    })
  }

  if (simulate) {
    return NextResponse.json({
      address: null,
      simulate: true,
      mode: 'simulate',
      message:
        'Simulation mode — no OWL_SWAP_ESCROW_SECRET_KEY. Offers are DB-only; nothing moves on-chain.',
    })
  }

  return NextResponse.json(
    {
      error: 'OwlSwap escrow is not configured (OWL_SWAP_ESCROW_SECRET_KEY).',
      address: null,
      simulate: false,
      mode: 'unavailable',
    },
    { status: 503 }
  )
}
