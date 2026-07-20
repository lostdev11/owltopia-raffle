import { getStakingPoolById } from '@/lib/db/staking-pools'
import {
  listStakingPositionsByWallet,
  markPositionUnstaked,
  type StakingPositionRow,
} from '@/lib/db/staking-positions'
import {
  isWalletNftFrozenForPool,
  readNestLockEligibilityForPool,
} from '@/lib/nesting/nft-lock-service'
import { positionRequiresOnChainNftFreezeLock } from '@/lib/nesting/nft-nest-onchain-lock'
import { sortStakingPositionsOldestFirst } from '@/lib/nesting/position-lifecycle'

export type ClearOrphanedActiveNestResult = {
  positionId: string
  asset_identifier: string | null
  cleared: boolean
  reason?: 'not_orphaned' | 'still_frozen_on_chain' | 'owner_thawed_claim_ok' | 'pool_not_found'
}

/**
 * Closes active NFT nest rows that have no on-chain lock (DB thinks nested, wallet does not).
 * Does not thaw NFTs — only fixes the app ledger so the holder can open a fresh nest.
 * Pool-aware: MPL Core (coins / Gen 1) and SPL token freeze (Gen 2).
 */
export async function clearOrphanedActiveNftNestsForWallet(
  wallet: string
): Promise<{ results: ClearOrphanedActiveNestResult[]; cleared_count: number }> {
  const positions = sortStakingPositionsOldestFirst(await listStakingPositionsByWallet(wallet))
  const results: ClearOrphanedActiveNestResult[] = []
  let clearedCount = 0

  for (const position of positions) {
    const r = await tryClearOrphanedActiveNest(position)
    results.push(r)
    if (r.cleared) clearedCount += 1
  }

  return { results, cleared_count: clearedCount }
}

async function tryClearOrphanedActiveNest(
  position: StakingPositionRow
): Promise<ClearOrphanedActiveNestResult> {
  const base = {
    positionId: position.id,
    asset_identifier: position.asset_identifier,
    cleared: false as const,
  }

  const pool = await getStakingPoolById(position.pool_id)
  if (!pool || !positionRequiresOnChainNftFreezeLock(position, pool)) {
    return { ...base, reason: 'not_orphaned' }
  }

  const assetId = position.asset_identifier!.trim()

  const frozen = await isWalletNftFrozenForPool({
    pool,
    assetId,
    collectionMint: pool.collection_key,
    ownerWallet: position.wallet_address,
  })
  if (frozen) {
    return { ...base, reason: 'still_frozen_on_chain' }
  }

  const lockState = await readNestLockEligibilityForPool({
    pool,
    assetId,
    ownerWallet: position.wallet_address,
    collectionMint: pool.collection_key,
  })
  // Only skip ledger clear when we positively know Owner-thawed claim is allowed (null read → still stuck).
  if (lockState?.ownerThawedEligible === true) {
    return { ...base, reason: 'owner_thawed_claim_ok' }
  }

  await markPositionUnstaked(position.id, position.wallet_address, {
    sync_status: 'confirmed',
    last_synced_at: new Date().toISOString(),
    last_transaction_error: null,
    external_reference: 'orphaned_active_cleared',
  })

  return { ...base, cleared: true }
}
