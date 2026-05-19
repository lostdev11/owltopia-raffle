/**
 * Best-effort: re-apply MPL Core freeze for active NFT nests that lost on-chain lock state.
 */

import { getStakingPoolById } from '@/lib/db/staking-pools'
import {
  listStakingPositionsByWallet,
  type StakingPositionRow,
} from '@/lib/db/staking-positions'
import {
  assertActiveNftNestOnChainLock,
  assertNftNestOnChainLockHeld,
  positionRequiresOnChainNftFreezeLock,
  poolUsesOnChainNftFreezeLock,
} from '@/lib/nesting/nft-nest-onchain-lock'
import { isWalletNftFrozenForNestingDelegate } from '@/lib/nesting/nft-freeze'
import { StakingUserError } from '@/lib/nesting/errors'

const RECONCILE_MAX_PER_REQUEST = 8

export type ReconcileActiveNftFreezeResult = {
  positionId: string
  reconciled: boolean
  error?: string
}

export async function reconcileActiveNftFreezeLocksForWallet(wallet: string): Promise<{
  results: ReconcileActiveNftFreezeResult[]
  positions: StakingPositionRow[]
}> {
  const positions = await listStakingPositionsByWallet(wallet)
  const candidates = positions.filter((p) => p.status === 'active' && p.asset_identifier?.trim())
  if (candidates.length === 0) {
    return { results: [], positions }
  }

  const results: ReconcileActiveNftFreezeResult[] = []
  let reconciledCount = 0

  for (const position of candidates) {
    if (reconciledCount >= RECONCILE_MAX_PER_REQUEST) break
    const pool = await getStakingPoolById(position.pool_id)
    if (!pool || !positionRequiresOnChainNftFreezeLock(position, pool)) continue

    try {
      await assertActiveNftNestOnChainLock(position, pool, { repairMissingFreeze: true })
      results.push({ positionId: position.id, reconciled: true })
      reconciledCount += 1
    } catch (e) {
      const message =
        e instanceof StakingUserError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not verify nest lock on-chain'
      results.push({ positionId: position.id, reconciled: false, error: message })
    }
  }

  return { results, positions }
}

export async function reconcileAllActiveNftFreezeLocksAdmin(params?: {
  poolSlug?: string
  limit?: number
}): Promise<{
  checked: number
  repaired: number
  failures: Array<{ positionId: string; wallet: string; assetId: string; error: string }>
}> {
  const { getStakingPoolBySlug } = await import('@/lib/db/staking-pools')
  const { getSupabaseAdmin } = await import('@/lib/supabase-admin')
  const poolSlug = params?.poolSlug?.trim() || 'owl-nest-365'
  const pool = await getStakingPoolBySlug(poolSlug)
  if (!pool) {
    throw new StakingUserError(`Staking pool "${poolSlug}" was not found.`, 404)
  }
  if (!poolUsesOnChainNftFreezeLock(pool)) {
    throw new StakingUserError(
      `Pool "${poolSlug}" is not configured for on-chain NFT freeze locks.`,
      400
    )
  }

  const limit = Math.min(Math.max(params?.limit ?? 40, 1), 200)
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('staking_positions')
    .select('id, wallet_address, asset_identifier')
    .eq('pool_id', pool.id)
    .eq('status', 'active')
    .not('asset_identifier', 'is', null)
    .limit(limit)

  if (error) throw new Error(error.message)

  const failures: Array<{ positionId: string; wallet: string; assetId: string; error: string }> = []
  let repaired = 0

  for (const row of data ?? []) {
    const assetId = String(row.asset_identifier ?? '').trim()
    const wallet = String(row.wallet_address ?? '').trim()
    if (!assetId || !wallet) continue

    try {
      const wasFrozen = await isWalletNftFrozenForNestingDelegate({
        assetId,
        collectionMint: pool.collection_key,
        ownerWallet: wallet,
      })
      await assertNftNestOnChainLockHeld({
        ownerWallet: wallet,
        assetId,
        collectionMint: pool.collection_key,
        repairMissingFreeze: true,
      })
      if (!wasFrozen) repaired += 1
    } catch (e) {
      failures.push({
        positionId: String(row.id),
        wallet,
        assetId,
        error:
          e instanceof StakingUserError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'freeze check failed',
      })
    }
  }

  return { checked: data?.length ?? 0, repaired, failures }
}
