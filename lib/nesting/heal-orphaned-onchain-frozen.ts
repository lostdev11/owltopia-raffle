/**
 * Re-activates nests that were cleared as orphaned while the on-chain nest lock
 * is still in place (wallet locked the NFT but the DB row was closed).
 *
 * Covers both `orphaned_pending_cleared` and `orphaned_active_cleared` — the latter
 * can happen when a transient RPC miss makes clear-orphaned-active think the lock is gone.
 */

import { getStakingPoolById } from '@/lib/db/staking-pools'
import {
  getActivePositionByAssetIdentifier,
  listStakingPositionsByWallet,
  patchStakingPosition,
  type StakingPositionRow,
} from '@/lib/db/staking-positions'
import { isWalletNftFrozenForNestingDelegate } from '@/lib/nesting/nft-freeze'

const HEAL_MAX_PER_PASS = 12

export type HealOrphanedOnChainFrozenResult = {
  positionId: string
  asset_identifier: string | null
  healed: boolean
  error?: string
}

const ORPHANED_CLEARED_REFS = new Set(['orphaned_pending_cleared', 'orphaned_active_cleared'])

function isOrphanedClearedRow(
  position: Pick<StakingPositionRow, 'status' | 'external_reference'>
): boolean {
  return (
    position.status === 'unstaked' &&
    ORPHANED_CLEARED_REFS.has((position.external_reference ?? '').trim())
  )
}

export async function healOrphanedOnChainFrozenNestsForWallet(wallet: string): Promise<{
  results: HealOrphanedOnChainFrozenResult[]
  healed_count: number
}> {
  const positions = await listStakingPositionsByWallet(wallet)
  const byAsset = new Map<string, StakingPositionRow>()

  for (const position of positions) {
    if (!isOrphanedClearedRow(position)) continue
    const assetId = position.asset_identifier?.trim()
    if (!assetId) continue
    const prev = byAsset.get(assetId)
    if (!prev || new Date(position.created_at).getTime() > new Date(prev.created_at).getTime()) {
      byAsset.set(assetId, position)
    }
  }

  const results: HealOrphanedOnChainFrozenResult[] = []
  let healedCount = 0

  for (const position of byAsset.values()) {
    if (healedCount >= HEAL_MAX_PER_PASS) break
    const assetId = position.asset_identifier!.trim()
    const base = { positionId: position.id, asset_identifier: assetId, healed: false as const }

    const pool = await getStakingPoolById(position.pool_id)
    if (!pool || pool.asset_type !== 'nft' || pool.adapter_mode !== 'onchain_enabled') {
      results.push({ ...base, error: 'pool_not_nft_onchain' })
      continue
    }

    const open = await getActivePositionByAssetIdentifier(pool.id, assetId)
    if (open) {
      results.push({ ...base, error: 'already_open' })
      continue
    }

    try {
      const frozen = await isWalletNftFrozenForNestingDelegate({
        assetId,
        collectionMint: pool.collection_key,
        ownerWallet: wallet,
      })
      if (!frozen) {
        results.push({ ...base, error: 'not_frozen_on_chain' })
        continue
      }

      await patchStakingPosition(position.id, {
        status: 'active',
        unstaked_at: null,
        sync_status: 'confirmed',
        last_synced_at: new Date().toISOString(),
        last_transaction_error: null,
        external_reference: `nft_freeze_confirmed:${assetId}`,
      })
      results.push({ ...base, healed: true })
      healedCount += 1
    } catch (e) {
      results.push({
        ...base,
        error: e instanceof Error ? e.message : 'heal_failed',
      })
    }
  }

  return { results, healed_count: healedCount }
}
