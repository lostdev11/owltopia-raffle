import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { listStakingPositionsByWallet } from '@/lib/db/staking-positions'
import { clearOrphanedActiveNftNestsForWallet } from '@/lib/nesting/clear-orphaned-active-nests'
import { clearOrphanedPendingNftNestsForWallet } from '@/lib/nesting/clear-orphaned-pending-nests'
import { healPendingNftNestsForWallet } from '@/lib/nesting/heal-pending-nft-freeze'
import { healOrphanedOnChainFrozenNestsForWallet } from '@/lib/nesting/heal-orphaned-onchain-frozen'
import { reconcileActiveNftFreezeLocksForWallet } from '@/lib/nesting/reconcile-active-nft-freeze'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
/** Heal/reconcile can fan out to Helius + MPL Core; stay under Vercel's function cap. */
export const maxDuration = 60

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'
/** Wall-clock budget for on-chain heal passes (ms). Returns DB positions even if heal is partial. */
const HEAL_WALL_CLOCK_MS = 22_000

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

    const healStarted = Date.now()
    const healBudgetExceeded = () => Date.now() - healStarted >= HEAL_WALL_CLOCK_MS

    const { cleared_count, results: clear_results } =
      await clearOrphanedPendingNftNestsForWallet(session.wallet)
    const { healed_count: healed_orphan_frozen_count, results: heal_orphan_frozen_results } =
      healBudgetExceeded()
        ? { healed_count: 0, results: [] as Awaited<ReturnType<typeof healOrphanedOnChainFrozenNestsForWallet>>['results'] }
        : await healOrphanedOnChainFrozenNestsForWallet(session.wallet)
    const { positions: afterHeal, results: heal_results } = healBudgetExceeded()
      ? {
          positions: await listStakingPositionsByWallet(session.wallet),
          results: [] as Awaited<ReturnType<typeof healPendingNftNestsForWallet>>['results'],
        }
      : await healPendingNftNestsForWallet(session.wallet)
    const { results: reconcile_results } = healBudgetExceeded()
      ? { results: [] as Awaited<ReturnType<typeof reconcileActiveNftFreezeLocksForWallet>>['results'] }
      : await reconcileActiveNftFreezeLocksForWallet(session.wallet)
    const { cleared_count: cleared_active_count, results: clear_active_results } =
      healBudgetExceeded()
        ? {
            cleared_count: 0,
            results: [] as Awaited<ReturnType<typeof clearOrphanedActiveNftNestsForWallet>>['results'],
          }
        : await clearOrphanedActiveNftNestsForWallet(session.wallet)
    const positions = healBudgetExceeded()
      ? afterHeal
      : (await listStakingPositionsByWallet(session.wallet))
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
      ...(cleared_active_count > 0
        ? {
            cleared_orphaned_active_count: cleared_active_count,
            clear_orphaned_active_results: clear_active_results.filter((r) => r.cleared),
          }
        : {}),
      ...(healBudgetExceeded() ? { heal_partial: true } : {}),
    })
  } catch (e) {
    console.error('[me/staking/positions]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
