/**
 * Pure helpers for admin force-leave candidate selection / batching (no DB / adapter I/O).
 */

import type { StakingPoolRow } from '@/lib/db/staking-pools'
import type { StakingPositionRow } from '@/lib/db/staking-positions'
import { isStakingUserError, StakingUserError } from '@/lib/nesting/errors'
import {
  isOpeningNftNestAbortable,
  isOpenStakingPosition,
  sortStakingPositionsOldestFirst,
} from '@/lib/nesting/position-lifecycle'
import { safeErrorMessage } from '@/lib/safe-error'

export type AdminOverrideUnstakeCandidate = {
  position_id: string
  pool_id: string
  pool_name: string | null
  pool_slug: string | null
  status: StakingPositionRow['status']
  asset_identifier: string | null
  amount: number
  staked_at: string
}

export type AdminOverrideUnstakeClosed = AdminOverrideUnstakeCandidate & {
  unstake_signature: string | null
  execution_path: 'onchain_token_transfer' | 'database_mock'
}

export type AdminOverrideUnstakeFailed = {
  position_id: string
  pool_id: string
  asset_identifier: string | null
  error: string
  status?: number
}

/**
 * Positions the single-id admin override would accept: active nests, plus abortable
 * opening NFT pending rows (same rules as executeUnstakeAdminOverride).
 */
export function selectAdminOverrideUnstakeCandidates(
  positions: StakingPositionRow[],
  poolsById: Map<string, Pick<StakingPoolRow, 'asset_type' | 'adapter_mode' | 'name' | 'slug'>>
): AdminOverrideUnstakeCandidate[] {
  const selected: StakingPositionRow[] = []
  for (const position of positions) {
    if (!isOpenStakingPosition(position)) continue
    if (position.status === 'active') {
      selected.push(position)
      continue
    }
    const pool = poolsById.get(position.pool_id)
    if (pool && isOpeningNftNestAbortable(position, pool)) {
      selected.push(position)
    }
  }

  return sortStakingPositionsOldestFirst(selected).map((position) => {
    const pool = poolsById.get(position.pool_id)
    return {
      position_id: position.id,
      pool_id: position.pool_id,
      pool_name: pool?.name ?? null,
      pool_slug: pool?.slug ?? null,
      status: position.status,
      asset_identifier: position.asset_identifier,
      amount: Number(position.amount),
      staked_at: position.staked_at,
    }
  })
}

/** Run a bounded force-leave batch; continues after per-position failures. */
export async function runAdminOverrideUnstakeBatch(params: {
  wallet: string
  candidates: AdminOverrideUnstakeCandidate[]
  limit: number
  open_position_count?: number
  unstakeOne: (positionId: string) => Promise<{
    position: Pick<StakingPositionRow, 'unstake_signature'>
  }>
}): Promise<{
  wallet: string
  closed: AdminOverrideUnstakeClosed[]
  failed: AdminOverrideUnstakeFailed[]
  remaining_eligible: number
  attempted: number
  eligible_total: number
}> {
  const eligibleTotal = params.candidates.length
  if (eligibleTotal === 0) {
    throw new StakingUserError('No open nests eligible for admin force leave on this wallet', 404, {
      wallet: params.wallet,
      open_position_count: params.open_position_count ?? 0,
    })
  }

  const limit = Math.max(1, params.limit)
  const batch = params.candidates.slice(0, limit)
  const closed: AdminOverrideUnstakeClosed[] = []
  const failed: AdminOverrideUnstakeFailed[] = []

  // #region agent log
  try {
    const fs = await import('fs')
    fs.appendFileSync(
      '/opt/cursor/logs/debug.log',
      JSON.stringify({
        location: 'admin-unstake-override-select.ts:runBatch:entry',
        message: 'wallet force-leave batch start',
        data: {
          wallet: params.wallet,
          eligibleTotal,
          limit,
          batchSize: batch.length,
          sampleAssets: batch.slice(0, 3).map((c) => ({
            position_id: c.position_id,
            pool_id: c.pool_id,
            asset: c.asset_identifier,
            status: c.status,
          })),
        },
        timestamp: Date.now(),
        hypothesisId: 'E',
      }) + '\n'
    )
  } catch {
    /* debug log best-effort */
  }
  // #endregion

  for (const candidate of batch) {
    try {
      const { position } = await params.unstakeOne(candidate.position_id)
      closed.push({
        ...candidate,
        unstake_signature: position.unstake_signature ?? null,
        execution_path: position.unstake_signature
          ? 'onchain_token_transfer'
          : 'database_mock',
      })
      // #region agent log
      try {
        const fs = await import('fs')
        fs.appendFileSync(
          '/opt/cursor/logs/debug.log',
          JSON.stringify({
            location: 'admin-unstake-override-select.ts:runBatch:closed',
            message: 'position closed',
            data: {
              position_id: candidate.position_id,
              asset: candidate.asset_identifier,
              pool_id: candidate.pool_id,
              hasSig: Boolean(position.unstake_signature),
            },
            timestamp: Date.now(),
            hypothesisId: 'E',
          }) + '\n'
        )
      } catch {
        /* debug log best-effort */
      }
      // #endregion
    } catch (e) {
      const message = isStakingUserError(e) ? e.message : safeErrorMessage(e)
      failed.push({
        position_id: candidate.position_id,
        pool_id: candidate.pool_id,
        asset_identifier: candidate.asset_identifier,
        error: message,
        status: isStakingUserError(e) ? e.status : undefined,
      })
      // #region agent log
      try {
        const fs = await import('fs')
        fs.appendFileSync(
          '/opt/cursor/logs/debug.log',
          JSON.stringify({
            location: 'admin-unstake-override-select.ts:runBatch:failed',
            message: 'position force-leave failed',
            data: {
              position_id: candidate.position_id,
              asset: candidate.asset_identifier,
              pool_id: candidate.pool_id,
              error: message,
              status: isStakingUserError(e) ? e.status : undefined,
              isStakingUserError: isStakingUserError(e),
            },
            timestamp: Date.now(),
            hypothesisId: 'A',
          }) + '\n'
        )
      } catch {
        /* debug log best-effort */
      }
      // #endregion
    }
  }

  // #region agent log
  try {
    const fs = await import('fs')
    fs.appendFileSync(
      '/opt/cursor/logs/debug.log',
      JSON.stringify({
        location: 'admin-unstake-override-select.ts:runBatch:summary',
        message: 'wallet force-leave batch done',
        data: {
          wallet: params.wallet,
          closed: closed.length,
          failed: failed.length,
          remaining_eligible: Math.max(0, eligibleTotal - closed.length),
          failedErrors: failed.map((f) => ({
            position_id: f.position_id,
            asset: f.asset_identifier,
            error: f.error,
            status: f.status,
          })),
        },
        timestamp: Date.now(),
        hypothesisId: 'A',
      }) + '\n'
    )
  } catch {
    /* debug log best-effort */
  }
  // #endregion

  return {
    wallet: params.wallet,
    closed,
    failed,
    remaining_eligible: Math.max(0, eligibleTotal - closed.length),
    attempted: batch.length,
    eligible_total: eligibleTotal,
  }
}
