import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { reconcileStakingReadModelBatch } from '@/lib/nesting/reconcile'
import { NESTING_RECONCILE_MAX_BATCH } from '@/lib/nesting/rpc-policy'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/staking/reconcile
 * Bounded batch: at most one `getParsedTransaction` per pending/stale row (see `NESTING_RECONCILE_MAX_BATCH`).
 * Not for hot paths — call manually or from a low-frequency cron.
 * Body: { limit?: number } (optional, capped)
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const body = await request.json().catch(() => ({}))
    const raw = body?.limit
    const limit =
      raw !== undefined && raw !== null && Number.isFinite(Number(raw))
        ? Number(raw)
        : NESTING_RECONCILE_MAX_BATCH

    const { processed, results } = await reconcileStakingReadModelBatch(limit)

    return NextResponse.json({
      processed,
      max_batch: NESTING_RECONCILE_MAX_BATCH,
      results,
    })
  } catch (e) {
    console.error('[admin/staking/reconcile]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
