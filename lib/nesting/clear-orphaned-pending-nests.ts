import { getStakingPoolById } from '@/lib/db/staking-pools'
import {
  listStakingPositionsByWallet,
  markPositionUnstaked,
  type StakingPositionRow,
} from '@/lib/db/staking-positions'
import { isWalletNftFrozenForPool } from '@/lib/nesting/nft-lock-service'
import {
  isPendingNftNestBeforeFreezeConfirmed,
  sortStakingPositionsOldestFirst,
} from '@/lib/nesting/position-lifecycle'

export type ClearOrphanedPendingNestResult = {
  positionId: string
  asset_identifier: string | null
  cleared: boolean
  reason?: 'not_orphaned' | 'still_frozen_on_chain' | 'pool_not_found' | 'opening_grace'
}

/** Do not clear in-flight opens until the holder has had time to approve the wallet lock (mobile). */
const DEFAULT_ORPHANED_PENDING_CLEAR_GRACE_MS = 10 * 60 * 1000

function orphanedPendingClearGraceMs(): number {
  const raw = process.env.NESTING_ORPHANED_PENDING_CLEAR_GRACE_MS?.trim()
  if (!raw) return DEFAULT_ORPHANED_PENDING_CLEAR_GRACE_MS
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_ORPHANED_PENDING_CLEAR_GRACE_MS
  return Math.floor(n)
}

/**
 * Closes pending NFT nest rows that never completed the wallet freeze. Does not thaw NFTs — only fixes the app ledger.
 * Pool-aware: MPL Core (coins / Gen 1) and SPL token freeze (Gen 2).
 */
export async function clearOrphanedPendingNftNestsForWallet(
  wallet: string
): Promise<{ results: ClearOrphanedPendingNestResult[]; cleared_count: number }> {
  const positions = sortStakingPositionsOldestFirst(await listStakingPositionsByWallet(wallet))
  const results: ClearOrphanedPendingNestResult[] = []
  let clearedCount = 0

  for (const position of positions) {
    const r = await tryClearOrphanedPendingNest(position)
    results.push(r)
    if (r.cleared) clearedCount += 1
  }

  return { results, cleared_count: clearedCount }
}

async function tryClearOrphanedPendingNest(
  position: StakingPositionRow
): Promise<ClearOrphanedPendingNestResult> {
  const base = {
    positionId: position.id,
    asset_identifier: position.asset_identifier,
    cleared: false as const,
  }

  if (
    !isPendingNftNestBeforeFreezeConfirmed(position) ||
    (position.external_reference ?? '').trim() !== 'awaiting_nft_freeze' ||
    !position.asset_identifier?.trim()
  ) {
    return { ...base, reason: 'not_orphaned' }
  }

  const pool = await getStakingPoolById(position.pool_id)
  if (!pool || pool.asset_type !== 'nft') {
    return { ...base, reason: 'pool_not_found' }
  }

  const createdMs = new Date(position.created_at).getTime()
  if (!Number.isNaN(createdMs) && Date.now() - createdMs < orphanedPendingClearGraceMs()) {
    return { ...base, reason: 'opening_grace' }
  }

  const frozen = await isWalletNftFrozenForPool({
    pool,
    assetId: position.asset_identifier,
    collectionMint: pool.collection_key,
    ownerWallet: position.wallet_address,
  })
  if (frozen) {
    return { ...base, reason: 'still_frozen_on_chain' }
  }

  await markPositionUnstaked(position.id, position.wallet_address, {
    sync_status: 'confirmed',
    last_synced_at: new Date().toISOString(),
    last_transaction_error: null,
    external_reference: 'orphaned_pending_cleared',
  })

  return { ...base, cleared: true }
}
