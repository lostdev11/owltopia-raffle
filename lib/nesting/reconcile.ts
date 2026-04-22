/**
 * Sparse reconciliation: process a **bounded** batch of rows (no loops, no wallet scans).
 * Call from an admin action or a scheduled job — never from a per-request hot path.
 */

import { listStakingPositionsForReconciliation } from '@/lib/db/staking-positions'
import { NESTING_RECONCILE_MAX_BATCH } from '@/lib/nesting/rpc-policy'
import { verifyStakingPositionFromChainByRow } from '@/lib/nesting/sync'

export type ReconcileStakingResult = {
  positionId: string
  ok: boolean
  error?: string
}

/**
 * Re-checks up to `limit` positions with `sync_status` pending/stale.
 * **At most one** `getParsedTransaction` per position that has a retriable signature.
 */
export async function reconcileStakingReadModelBatch(
  limit = NESTING_RECONCILE_MAX_BATCH
): Promise<{ processed: number; results: ReconcileStakingResult[] }> {
  const cap = Math.min(Math.max(1, limit), NESTING_RECONCILE_MAX_BATCH)
  const rows = await listStakingPositionsForReconciliation(cap)
  const results: ReconcileStakingResult[] = []

  for (const row of rows) {
    const r = await verifyStakingPositionFromChainByRow(row)
    if (r.ok) {
      results.push({ positionId: row.id, ok: true })
    } else {
      results.push({ positionId: row.id, ok: false, error: r.error })
    }
  }

  return { processed: results.length, results }
}
