import { getStakingPoolById } from '@/lib/db/staking-pools'
import {
  listStakingPositionsByWallet,
  markPositionUnstaked,
  type StakingPositionRow,
} from '@/lib/db/staking-positions'
import { isWalletNftFrozenForNestingDelegate } from '@/lib/nesting/nft-freeze'
import { isPendingNftNestBeforeFreezeConfirmed } from '@/lib/nesting/position-lifecycle'

export type ClearOrphanedPendingNestResult = {
  positionId: string
  asset_identifier: string | null
  cleared: boolean
  reason?: 'not_orphaned' | 'still_frozen_on_chain' | 'pool_not_found'
}

/**
 * Closes pending NFT nest rows that never completed the wallet freeze. Does not thaw NFTs — only fixes the app ledger.
 */
export async function clearOrphanedPendingNftNestsForWallet(
  wallet: string
): Promise<{ results: ClearOrphanedPendingNestResult[]; cleared_count: number }> {
  const positions = await listStakingPositionsByWallet(wallet)
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

  const frozen = await isWalletNftFrozenForNestingDelegate({
    assetId: position.asset_identifier,
    collectionMint: pool.collection_key,
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
