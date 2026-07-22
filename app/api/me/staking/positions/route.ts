import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { listStakingPositionsByWallet } from '@/lib/db/staking-positions'
import { withRetry } from '@/lib/db-retry'
import { clearOrphanedActiveNftNestsForWallet } from '@/lib/nesting/clear-orphaned-active-nests'
import { clearOrphanedPendingNftNestsForWallet } from '@/lib/nesting/clear-orphaned-pending-nests'
import { healPendingNftNestsForWallet } from '@/lib/nesting/heal-pending-nft-freeze'
import { healOrphanedOnChainFrozenNestsForWallet } from '@/lib/nesting/heal-orphaned-onchain-frozen'
import { reconcileActiveNftFreezeLocksForWallet } from '@/lib/nesting/reconcile-active-nft-freeze'
import { clearCrossWalletStaleNestsForWallet } from '@/lib/nesting/clear-cross-wallet-stale-nests'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
/** Heal/reconcile can fan out to Helius + MPL Core; stay under Vercel's function cap. */
export const maxDuration = 60

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'
/** Wall-clock budget for on-chain heal passes (ms). Returns DB positions even if heal is partial. */
const HEAL_WALL_CLOCK_MS = 22_000

async function listPositionsReliable(wallet: string) {
  return withRetry(() => listStakingPositionsByWallet(wallet), {
    maxRetries: 2,
    initialDelayMs: 200,
    maxDelayMs: 1500,
  })
}

/** Soft-fail one heal step so RPC/DB blips don't turn the whole My nest load into a 500. */
async function runHealStep<T>(
  label: string,
  budgetExceeded: () => boolean,
  empty: T,
  run: () => Promise<T>,
  markPartial: () => void
): Promise<T> {
  if (budgetExceeded()) {
    markPartial()
    return empty
  }
  try {
    return await run()
  } catch (e) {
    markPartial()
    console.warn(`[me/staking/positions] ${label} skipped:`, e instanceof Error ? e.message : e)
    return empty
  }
}

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
      const positions = await listPositionsReliable(session.wallet)
      return NextResponse.json({ wallet: session.wallet, positions })
    }

    const healStarted = Date.now()
    const healBudgetExceeded = () => Date.now() - healStarted >= HEAL_WALL_CLOCK_MS
    let healPartial = false
    const markPartial = () => {
      healPartial = true
    }

    const emptyClear = {
      cleared_count: 0,
      results: [] as Awaited<ReturnType<typeof clearOrphanedPendingNftNestsForWallet>>['results'],
    }
    const emptyHealFrozen = {
      healed_count: 0,
      results: [] as Awaited<ReturnType<typeof healOrphanedOnChainFrozenNestsForWallet>>['results'],
    }
    const emptyHealPending = {
      positions: [] as Awaited<ReturnType<typeof healPendingNftNestsForWallet>>['positions'],
      results: [] as Awaited<ReturnType<typeof healPendingNftNestsForWallet>>['results'],
    }
    const emptyReconcile = {
      results: [] as Awaited<ReturnType<typeof reconcileActiveNftFreezeLocksForWallet>>['results'],
    }

    const { cleared_count, results: clear_results } = await runHealStep(
      'clearOrphanedPending',
      () => false,
      emptyClear,
      () => clearOrphanedPendingNftNestsForWallet(session.wallet),
      markPartial
    )

    const { cleared_count: cleared_cross_wallet_count, results: clear_cross_wallet_results } =
      await runHealStep(
        'clearCrossWalletStale',
        healBudgetExceeded,
        emptyClear,
        () => clearCrossWalletStaleNestsForWallet(session.wallet),
        markPartial
      )

    const { healed_count: healed_orphan_frozen_count, results: heal_orphan_frozen_results } =
      await runHealStep(
        'healOrphanedOnChainFrozen',
        healBudgetExceeded,
        emptyHealFrozen,
        () => healOrphanedOnChainFrozenNestsForWallet(session.wallet),
        markPartial
      )

    const pendingHeal = await runHealStep(
      'healPendingNftNests',
      healBudgetExceeded,
      emptyHealPending,
      () => healPendingNftNestsForWallet(session.wallet),
      markPartial
    )
    const afterHeal =
      pendingHeal.results.length > 0 || pendingHeal.positions.length > 0
        ? pendingHeal.positions
        : await listPositionsReliable(session.wallet)
    const heal_results = pendingHeal.results

    const { results: reconcile_results } = await runHealStep(
      'reconcileActiveNftFreeze',
      healBudgetExceeded,
      emptyReconcile,
      () => reconcileActiveNftFreezeLocksForWallet(session.wallet),
      markPartial
    )

    const { cleared_count: cleared_active_count, results: clear_active_results } = await runHealStep(
      'clearOrphanedActive',
      healBudgetExceeded,
      emptyClear,
      () => clearOrphanedActiveNftNestsForWallet(session.wallet),
      markPartial
    )

    const positions = healBudgetExceeded()
      ? afterHeal
      : await listPositionsReliable(session.wallet)

    if (healBudgetExceeded()) markPartial()

    const healed_count = heal_results.filter((r) => r.healed).length
    const reconciled_count = reconcile_results.filter((r) => r.reconciled).length
    const reconcile_failures = reconcile_results.filter((r) => !r.reconciled)
    return NextResponse.json({
      wallet: session.wallet,
      positions,
      ...(cleared_count > 0
        ? { cleared_orphaned_count: cleared_count, clear_orphaned_results: clear_results.filter((r) => r.cleared) }
        : {}),
      ...(healed_orphan_frozen_count > 0
        ? {
            healed_orphan_frozen_count,
            heal_orphan_frozen_results: heal_orphan_frozen_results.filter((r) => r.healed),
          }
        : {}),
      ...(healed_count > 0 ? { healed_count, heal_results } : {}),
      ...(reconciled_count > 0 ? { reconciled_freeze_count: reconciled_count } : {}),
      ...(reconcile_failures.length > 0 ? { reconcile_freeze_issues: reconcile_failures } : {}),
      ...(cleared_active_count > 0
        ? {
            cleared_orphaned_active_count: cleared_active_count,
            clear_orphaned_active_results: clear_active_results.filter((r) => r.cleared),
          }
        : {}),
      ...(cleared_cross_wallet_count > 0
        ? {
            cleared_cross_wallet_count,
            clear_cross_wallet_results: clear_cross_wallet_results.filter((r) => r.cleared),
          }
        : {}),
      ...(healPartial ? { heal_partial: true } : {}),
    })
  } catch (e) {
    console.error('[me/staking/positions]', e)
    // Last resort: still try to return DB nests so mobile does not only see "Internal server error".
    try {
      const session = await requireSession(request)
      if (!(session instanceof NextResponse)) {
        const positions = await listPositionsReliable(session.wallet)
        return NextResponse.json({
          wallet: session.wallet,
          positions,
          heal_partial: true,
          heal_error: true,
        })
      }
    } catch (fallbackErr) {
      console.error('[me/staking/positions] fallback list failed', fallbackErr)
    }
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
