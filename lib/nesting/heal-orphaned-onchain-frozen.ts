/**
 * Re-activates nests that were cleared as orphaned while the on-chain Owner freeze lock
 * is still in place (wallet locked the coin but the DB row was closed before `active`).
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

function isOrphanedPendingClearedRow(
  position: Pick<StakingPositionRow, 'status' | 'external_reference'>
): boolean {
  return (
    position.status === 'unstaked' &&
    (position.external_reference ?? '').trim() === 'orphaned_pending_cleared'
  )
}

export async function healOrphanedOnChainFrozenNestsForWallet(wallet: string): Promise<{
  results: HealOrphanedOnChainFrozenResult[]
  healed_count: number
}> {
  const positions = await listStakingPositionsByWallet(wallet)
  const byAsset = new Map<string, StakingPositionRow>()

  for (const position of positions) {
    if (!isOrphanedPendingClearedRow(position)) continue
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
