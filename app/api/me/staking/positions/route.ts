import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { listStakingPositionsByWallet } from '@/lib/db/staking-positions'
import { clearOrphanedPendingNftNestsForWallet } from '@/lib/nesting/clear-orphaned-pending-nests'
import { healPendingNftNestsForWallet } from '@/lib/nesting/heal-pending-nft-freeze'
import { healOrphanedOnChainFrozenNestsForWallet } from '@/lib/nesting/heal-orphaned-onchain-frozen'
import { reconcileActiveNftFreezeLocksForWallet } from '@/lib/nesting/reconcile-active-nft-freeze'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * GET /api/me/staking/positions
 * SIWS session required — returns staking rows for the session wallet (DB-backed).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connectedWallet = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (connectedWallet && connectedWallet !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session. Please sign in again.' },
        { status: 401 }
      )
    }

    const healDisabled = request.nextUrl.searchParams.get('heal') === '0'
    if (healDisabled) {
      const positions = await listStakingPositionsByWallet(session.wallet)
      return NextResponse.json({ wallet: session.wallet, positions })
    }

    const { cleared_count, results: clear_results } =
      await clearOrphanedPendingNftNestsForWallet(session.wallet)
    const { healed_count: healed_orphan_frozen_count, results: heal_orphan_frozen_results } =
      await healOrphanedOnChainFrozenNestsForWallet(session.wallet)
    const { positions: afterHeal, results: heal_results } = await healPendingNftNestsForWallet(session.wallet)
    const { results: reconcile_results } = await reconcileActiveNftFreezeLocksForWallet(session.wallet)
    const positions = afterHeal
    const healed_count = heal_results.filter((r) => r.healed).length
    const reconciled_count = reconcile_results.filter((r) => r.reconciled).length
    const reconcile_failures = reconcile_results.filter((r) => !r.reconciled)
    return NextResponse.json({
      wallet: session.wallet,
      positions,
      ...(cleared_count > 0 ? { cleared_orphaned_count: cleared_count, clear_orphaned_results: clear_results.filter((r) => r.cleared) } : {}),
      ...(healed_orphan_frozen_count > 0
        ? {
            healed_orphan_frozen_count,
            heal_orphan_frozen_results: heal_orphan_frozen_results.filter((r) => r.healed),
          }
        : {}),
      ...(healed_count > 0 ? { healed_count, heal_results } : {}),
      ...(reconciled_count > 0 ? { reconciled_freeze_count: reconciled_count } : {}),
      ...(reconcile_failures.length > 0
        ? { reconcile_freeze_issues: reconcile_failures }
        : {}),
    })
  } catch (e) {
    console.error('[me/staking/positions]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
