import { NextResponse } from 'next/server'
import { listActiveStakingPools } from '@/lib/db/staking-pools'
import { safeErrorMessage } from '@/lib/safe-error'
import { getNestingNftFreezeDelegateAddress } from '@/lib/nesting/nft-freeze'
import { isNestingGloballyDisabled } from '@/lib/nesting/policy'

export const dynamic = 'force-dynamic'

/**
 * GET /api/staking/pools
 * Public active pools list (Supabase only; no RPC).
 */
export async function GET() {
  try {
    const pools = await listActiveStakingPools()
    return NextResponse.json({
      pools,
      nesting_nft_freeze_delegate: getNestingNftFreezeDelegateAddress() || null,
      nesting_disabled: isNestingGloballyDisabled(),
    })
  } catch (e) {
    console.error('[staking/pools]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
