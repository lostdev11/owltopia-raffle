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
import { STAKING_UUID_RE } from '@/lib/nesting/validation'

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

async function resolveOptionalPoolScope(poolIdRaw: string | null | undefined): Promise<{
  pool_id: string | null
  pool_name: string | null
  pool_slug: string | null
}> {
  const pool_id = typeof poolIdRaw === 'string' ? poolIdRaw.trim() : ''
  if (!pool_id) {
    return { pool_id: null, pool_name: null, pool_slug: null }
  }
  if (!STAKING_UUID_RE.test(pool_id)) {
    throw new StakingUserError('Invalid pool_id', 400)
  }
  const pool = await getStakingPoolById(pool_id)
  if (!pool) {
    throw new StakingUserError('Pool not found', 404)
  }
  return {
    pool_id: pool.id,
    pool_name: pool.name ?? null,
    pool_slug: pool.slug ?? null,
  }
}

/** List nests that would be closed by wallet-level admin force leave (no mutations). */
export async function listAdminOverrideUnstakeCandidates(
  walletAddress: string,
  options?: { pool_id?: string | null }
): Promise<{
  wallet: string
  candidates: AdminOverrideUnstakeCandidate[]
  open_position_count: number
  pool_id: string | null
  pool_name: string | null
  pool_slug: string | null
}> {
  const wallet = normalizeSolanaWalletAddress(walletAddress)
  if (!wallet) {
    throw new StakingUserError('Invalid wallet_address', 400)
  }

  const scope = await resolveOptionalPoolScope(options?.pool_id)

  const positions = await listStakingPositionsByWallet(wallet)
  const open = positions.filter(isOpenStakingPosition)
  const poolsById = await loadPoolsForPositions(open)
  const candidates = selectAdminOverrideUnstakeCandidates(open, poolsById, {
    pool_id: scope.pool_id,
  })
  const openScoped = scope.pool_id
    ? open.filter((p) => p.pool_id === scope.pool_id)
    : open

  return {
    wallet,
    candidates,
    open_position_count: openScoped.length,
    pool_id: scope.pool_id,
    pool_name: scope.pool_name,
    pool_slug: scope.pool_slug,
  }
}

/**
 * Force-leave up to {@link NESTING_ADMIN_UNSTAKE_ALL_MAX_BATCH} eligible open nests for a holder.
 * Continues after per-position failures so partial recovery still progresses.
 * Optional `pool_id` limits the batch to one perch/project.
 */
export async function executeUnstakeAdminOverrideByWallet(params: {
  wallet_address: string
  /** Cap per request (default / max from rpc-policy). */
  limit?: number
  /** When set, only nests on this staking pool are closed. */
  pool_id?: string | null
  unstakeOne: (positionId: string) => Promise<{
    position: StakingPositionRow
    nest_owner_thaw?: { mint: string } | null
  }>
}): Promise<{
  wallet: string
  closed: AdminOverrideUnstakeClosed[]
  failed: AdminOverrideUnstakeFailed[]
  remaining_eligible: number
  attempted: number
  eligible_total: number
  needs_owner_thaw_count: number
  pool_id: string | null
  pool_name: string | null
  pool_slug: string | null
}> {
  const wallet = normalizeSolanaWalletAddress(params.wallet_address)
  if (!wallet) {
    throw new StakingUserError('Invalid wallet_address', 400)
  }

  const limit = Math.min(
    Math.max(1, params.limit ?? NESTING_ADMIN_UNSTAKE_ALL_MAX_BATCH),
    NESTING_ADMIN_UNSTAKE_ALL_MAX_BATCH
  )

  const listed = await listAdminOverrideUnstakeCandidates(wallet, {
    pool_id: params.pool_id,
  })
  if (listed.candidates.length === 0 && listed.pool_id) {
    throw new StakingUserError(
      'No open nests eligible for admin force leave on this wallet for the selected project',
      404,
      {
        wallet,
        pool_id: listed.pool_id,
        pool_slug: listed.pool_slug,
        open_position_count: listed.open_position_count,
      }
    )
  }
  const batch = await runAdminOverrideUnstakeBatch({
    wallet,
    candidates: listed.candidates,
    open_position_count: listed.open_position_count,
    limit,
    unstakeOne: params.unstakeOne,
  })
  return {
    ...batch,
    pool_id: listed.pool_id,
    pool_name: listed.pool_name,
    pool_slug: listed.pool_slug,
  }
}
