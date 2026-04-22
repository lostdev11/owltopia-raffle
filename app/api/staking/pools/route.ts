import { NextResponse } from 'next/server'
import { listActiveStakingPools } from '@/lib/db/staking-pools'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/staking/pools
 * Public list of active staking pools (Supabase only; no RPC).
 */
export async function GET() {
  try {
    const pools = await listActiveStakingPools()
    return NextResponse.json({ pools })
  } catch (e) {
    console.error('[staking/pools]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
