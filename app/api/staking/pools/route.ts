import { NextResponse } from 'next/server'
import { listActiveStakingPools } from '@/lib/db/staking-pools'
import { safeErrorMessage } from '@/lib/safe-error'
import { getNestingEscrowWalletAddress } from '@/lib/nesting/escrow-keypair'

export const dynamic = 'force-dynamic'

/**
 * GET /api/staking/pools
 * Public active pools list (Supabase only; no RPC).
 */
export async function GET() {
  try {
    const pools = await listActiveStakingPools()
    return NextResponse.json({ pools, nesting_escrow_wallet: getNestingEscrowWalletAddress() || null })
  } catch (e) {
    console.error('[staking/pools]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
