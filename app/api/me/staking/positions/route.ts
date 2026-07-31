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
/**
 * Fast nest list must finish well under the client 28s fetch timeout.
 * Supabase connect blips are ~10s each — cap attempts so we return 503 instead of hanging into a 504.
 */
const LIST_DEADLINE_MS = 12_000
const LIST_ATTEMPT_TIMEOUT_MS = 5_500
const FALLBACK_LIST_DEADLINE_MS = 8_000

const TRANSIENT_LIST_ERROR =
  'Nest data is temporarily slow to load. Tap Retry — your nests are safe.'

async function listPositionsReliable(
  wallet: string,
  opts?: { deadlineMs?: number; attemptTimeoutMs?: number }
) {
  return withRetry(() => listStakingPositionsByWallet(wallet), {
    maxRetries: 1,
    initialDelayMs: 150,
    maxDelayMs: 400,
    deadlineMs: opts?.deadlineMs ?? LIST_DEADLINE_MS,
    attemptTimeoutMs: opts?.attemptTimeoutMs ?? LIST_ATTEMPT_TIMEOUT_MS,
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
  let sessionWallet: string | null = null
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session
    sessionWallet = session.wallet

    const connectedWallet = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (connectedWallet && connectedWallet !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session. Please sign in again.' },
        { status: 401 }
      )
    }

    const healDisabled = request.nextUrl.searchParams.get('heal') === '0'
    if (healDisabled) {
      try {
        const positions = await listPositionsReliable(session.wallet)
        return NextResponse.json({ wallet: session.wallet, positions })
      } catch (listErr) {
        console.error('[me/staking/positions] fast list failed:', listErr)
        return NextResponse.json({ error: TRANSIENT_LIST_ERROR, retryable: true }, { status: 503 })
      }
    }

    const healStarted = Date.now()
    const healBudgetExceeded = () => Date.now() - healStarted >= HEAL_WALL_CLOCK_MS
    let healPartial = false
    const markPartial = () => {
      healPartial = true
    }

    const emptyClearPending = {
      cleared_count: 0,
      results: [] as Awaited<ReturnType<typeof clearOrphanedPendingNftNestsForWallet>>['results'],
    }
    const emptyClearCrossWallet = {
      cleared_count: 0,
      results: [] as Awaited<ReturnType<typeof clearCrossWalletStaleNestsForWallet>>['results'],
    }
    const emptyClearActive = {
      cleared_count: 0,
      results: [] as Awaited<ReturnType<typeof clearOrphanedActiveNftNestsForWallet>>['results'],
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
      healBudgetExceeded,
      emptyClearPending,
      () => clearOrphanedPendingNftNestsForWallet(session.wallet),
      markPartial
    )

    const { cleared_count: cleared_cross_wallet_count, results: clear_cross_wallet_results } =
      await runHealStep(
        'clearCrossWalletStale',
        healBudgetExceeded,
        emptyClearCrossWallet,
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
        : await listPositionsReliable(session.wallet).catch((listErr) => {
            markPartial()
            console.warn(
              '[me/staking/positions] list after heal skipped:',
              listErr instanceof Error ? listErr.message : listErr
            )
            return [] as Awaited<ReturnType<typeof listStakingPositionsByWallet>>
          })
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
      emptyClearActive,
      () => clearOrphanedActiveNftNestsForWallet(session.wallet),
      markPartial
    )

    const positions = healBudgetExceeded()
      ? afterHeal
      : await listPositionsReliable(session.wallet).catch((listErr) => {
          markPartial()
          console.warn(
            '[me/staking/positions] final list skipped:',
            listErr instanceof Error ? listErr.message : listErr
          )
          return afterHeal
        })

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
    // Reuse the session wallet already resolved — do not spend another round-trip on requireSession.
    if (sessionWallet) {
      try {
        const positions = await listPositionsReliable(sessionWallet, {
          deadlineMs: FALLBACK_LIST_DEADLINE_MS,
          attemptTimeoutMs: 4_000,
        })
        return NextResponse.json({
          wallet: sessionWallet,
          positions,
          heal_partial: true,
          heal_error: true,
        })
      } catch (fallbackErr) {
        console.error('[me/staking/positions] fallback list failed', fallbackErr)
      }
    }
    return NextResponse.json({ error: safeErrorMessage(e), retryable: true }, { status: 500 })
  }
}
