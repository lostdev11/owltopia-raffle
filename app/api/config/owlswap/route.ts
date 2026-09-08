import { NextResponse } from 'next/server'
import { getOwlSwapPublicConfig } from '@/lib/owlswap/owlswap-config'

export const dynamic = 'force-dynamic'

/**
 * GET /api/config/owlswap
 * Public OwlSwap ops + escrow addresses (no secrets).
 * Returns 503 if either wallet is missing or secret/pubkey mismatch.
 */
export async function GET() {
  const config = getOwlSwapPublicConfig()
  if (!config.wallet || !config.escrow) {
    return NextResponse.json(
      { error: 'OwlSwap wallets are not configured' },
      { status: 503 }
    )
  }
  return NextResponse.json({
    wallet: config.wallet,
    escrow: config.escrow,
    configured: config.configured,
  })
}
