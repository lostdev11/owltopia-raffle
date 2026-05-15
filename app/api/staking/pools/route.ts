import { NextResponse } from 'next/server'
import { listActiveStakingPools } from '@/lib/db/staking-pools'
import { safeErrorMessage } from '@/lib/safe-error'
import { getNestingNftFreezeDelegateAddress } from '@/lib/nesting/nft-freeze'
import { getNestingActionsPauseBreakdown } from '@/lib/nesting/policy'

export const dynamic = 'force-dynamic'

/**
 * GET /api/staking/pools
 * Public active pools list (Supabase only; no RPC).
 * Includes `nesting_disabled` plus `nesting_paused_by_deploy_env` / `nesting_paused_by_admin` so the UI can explain pauses.
 */
export async function GET() {
  try {
    const pools = await listActiveStakingPools()
    const pause = await getNestingActionsPauseBreakdown()
    return NextResponse.json({
      pools,
      nesting_nft_freeze_delegate: getNestingNftFreezeDelegateAddress() || null,
      nesting_disabled: pause.disabled,
      nesting_paused_by_deploy_env: pause.envKillSwitch,
      nesting_paused_by_admin: pause.adminDbPaused,
    })
  } catch (e) {
    console.error('[staking/pools]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
