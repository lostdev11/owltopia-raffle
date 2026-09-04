/**
 * Admin force-leave helpers: list and batch-close open nests by holder wallet.
 */

import { getStakingPoolById } from '@/lib/db/staking-pools'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import {
  listStakingPositionsByWallet,
  type StakingPositionRow,
} from '@/lib/db/staking-positions'
import {
  runAdminOverrideUnstakeBatch,
  selectAdminOverrideUnstakeCandidates,
  type AdminOverrideUnstakeCandidate,
  type AdminOverrideUnstakeClosed,
  type AdminOverrideUnstakeFailed,
} from '@/lib/nesting/admin-unstake-override-select'
import { StakingUserError } from '@/lib/nesting/errors'
import { isOpenStakingPosition } from '@/lib/nesting/position-lifecycle'
import { NESTING_ADMIN_UNSTAKE_ALL_MAX_BATCH } from '@/lib/nesting/rpc-policy'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type {
  AdminOverrideUnstakeCandidate,
  AdminOverrideUnstakeClosed,
  AdminOverrideUnstakeFailed,
}
export { selectAdminOverrideUnstakeCandidates, runAdminOverrideUnstakeBatch }

type PoolAbortShape = Pick<StakingPoolRow, 'id' | 'asset_type' | 'adapter_mode' | 'name' | 'slug'>

async function loadPoolsForPositions(
  positions: StakingPositionRow[]
): Promise<Map<string, PoolAbortShape>> {
  const ids = [...new Set(positions.map((p) => p.pool_id).filter(Boolean))]
  const poolsById = new Map<string, PoolAbortShape>()
  await Promise.all(
    ids.map(async (id) => {
      const pool = await getStakingPoolById(id)
      if (pool) {
        poolsById.set(id, {
          id: pool.id,
          asset_type: pool.asset_type,
          adapter_mode: pool.adapter_mode,
          name: pool.name,
          slug: pool.slug,
        })
      }
    })
  )
  return poolsById
}

/** List nests that would be closed by wallet-level admin force leave (no mutations). */
export async function listAdminOverrideUnstakeCandidates(walletAddress: string): Promise<{
  wallet: string
  candidates: AdminOverrideUnstakeCandidate[]
  open_position_count: number
}> {
  const wallet = normalizeSolanaWalletAddress(walletAddress)
  if (!wallet) {
    throw new StakingUserError('Invalid wallet_address', 400)
  }

  const positions = await listStakingPositionsByWallet(wallet)
  const open = positions.filter(isOpenStakingPosition)
  const poolsById = await loadPoolsForPositions(open)
  const candidates = selectAdminOverrideUnstakeCandidates(open, poolsById)

  return {
    wallet,
    candidates,
    open_position_count: open.length,
  }
}

/**
 * Force-leave up to {@link NESTING_ADMIN_UNSTAKE_ALL_MAX_BATCH} eligible open nests for a holder.
 * Continues after per-position failures so partial recovery still progresses.
 */
export async function executeUnstakeAdminOverrideByWallet(params: {
  wallet_address: string
  /** Cap per request (default / max from rpc-policy). */
  limit?: number
  unstakeOne: (positionId: string) => Promise<{
    position: StakingPositionRow
  }>
}): Promise<{
  wallet: string
  closed: AdminOverrideUnstakeClosed[]
  failed: AdminOverrideUnstakeFailed[]
  remaining_eligible: number
  attempted: number
  eligible_total: number
}> {
  const wallet = normalizeSolanaWalletAddress(params.wallet_address)
  if (!wallet) {
    throw new StakingUserError('Invalid wallet_address', 400)
  }

  const limit = Math.min(
    Math.max(1, params.limit ?? NESTING_ADMIN_UNSTAKE_ALL_MAX_BATCH),
    NESTING_ADMIN_UNSTAKE_ALL_MAX_BATCH
  )

  const listed = await listAdminOverrideUnstakeCandidates(wallet)
  return runAdminOverrideUnstakeBatch({
    wallet,
    candidates: listed.candidates,
    open_position_count: listed.open_position_count,
    limit,
    unstakeOne: params.unstakeOne,
  })
}
