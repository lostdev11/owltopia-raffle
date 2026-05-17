/**
 * Activates NFT nests stuck in `pending` when the on-chain freeze is already in place
 * (wallet signed delegate + freeze, but DB never reached `active`).
 */

import { getStakingPoolById } from '@/lib/db/staking-pools'
import {
  listStakingPositionsByWallet,
  patchStakingPosition,
  type StakingPositionRow,
} from '@/lib/db/staking-positions'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import {
  isOpeningNftNestAbortable,
  isPendingNftNestBeforeFreezeConfirmed,
  isPendingNftNestFreezeConfirmedButNotActive,
} from '@/lib/nesting/position-lifecycle'
import { assertWalletNftFrozenForNesting, isWalletNftFrozenForNestingDelegate } from '@/lib/nesting/nft-freeze'
import { StakingUserError } from '@/lib/nesting/errors'

const HEAL_MAX_PER_REQUEST = 6

export type HealPendingNftNestResult = {
  positionId: string
  healed: boolean
  error?: string
}

function isPendingNftNestHealCandidate(
  position: Pick<StakingPositionRow, 'status' | 'asset_identifier' | 'external_reference'>,
  pool: Pick<StakingPoolRow, 'asset_type' | 'adapter_mode'>
): boolean {
  if (position.status !== 'pending' || !position.asset_identifier?.trim()) {
    return false
  }
  if (pool.asset_type !== 'nft' || pool.adapter_mode !== 'onchain_enabled') {
    return false
  }
  return (
    isPendingNftNestFreezeConfirmedButNotActive(position) ||
    isPendingNftNestBeforeFreezeConfirmed(position)
  )
}

/** DB says pending but freeze was recorded — promote to active without another RPC round-trip. */
async function activatePendingWithConfirmedFreezeRef(
  position: StakingPositionRow
): Promise<StakingPositionRow> {
  const ref = position.external_reference?.trim() ?? ''
  const tokenAccount = ref.startsWith('nft_freeze_confirmed:')
    ? ref.slice('nft_freeze_confirmed:'.length)
    : position.asset_identifier!.trim()

  return patchStakingPosition(position.id, {
    status: 'active',
    stake_signature: position.stake_signature ?? null,
    sync_status: 'confirmed',
    last_synced_at: new Date().toISOString(),
    last_transaction_error: null,
    external_reference: `nft_freeze_confirmed:${tokenAccount}`,
  })
}

export async function tryHealPendingNftNestPosition(
  position: StakingPositionRow,
  pool: StakingPoolRow
): Promise<{ healed: boolean; position?: StakingPositionRow; error?: string }> {
  if (!isPendingNftNestHealCandidate(position, pool)) {
    return { healed: false }
  }

  const freezeRefConfirmed = (position.external_reference ?? '').startsWith('nft_freeze_confirmed:')
  if (freezeRefConfirmed) {
    const frozenOnChain = await isWalletNftFrozenForNestingDelegate({
      assetId: position.asset_identifier!,
      collectionMint: pool.collection_key,
    })
    if (!frozenOnChain) {
      try {
        await assertWalletNftFrozenForNesting({
          ownerWallet: position.wallet_address,
          assetId: position.asset_identifier!,
          collectionMint: pool.collection_key,
        })
      } catch (e) {
        const message =
          e instanceof StakingUserError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Could not confirm nest on-chain'
        return { healed: false, error: message }
      }
    }
    const updated = await activatePendingWithConfirmedFreezeRef(position)
    return { healed: true, position: updated }
  }

  if (!isOpeningNftNestAbortable(position, pool)) {
    return { healed: false }
  }

  try {
    const frozen = await assertWalletNftFrozenForNesting({
      ownerWallet: position.wallet_address,
      assetId: position.asset_identifier!,
      collectionMint: pool.collection_key,
    })
    const updated = await patchStakingPosition(position.id, {
      status: 'active',
      stake_signature: position.stake_signature ?? null,
      sync_status: 'confirmed',
      last_synced_at: new Date().toISOString(),
      last_transaction_error: null,
      external_reference: `nft_freeze_confirmed:${frozen.tokenAccount}`,
    })
    return { healed: true, position: updated }
  } catch (e) {
    const message =
      e instanceof StakingUserError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Could not confirm nest on-chain'
    return { healed: false, error: message }
  }
}

/**
 * Best-effort: promote pending NFT nests to `active` when chain state allows.
 * Returns refreshed positions for the wallet.
 */
export async function healPendingNftNestsForWallet(wallet: string): Promise<{
  results: HealPendingNftNestResult[]
  positions: StakingPositionRow[]
}> {
  const positions = await listStakingPositionsByWallet(wallet)
  const candidates = positions.filter((p) => p.status === 'pending' && p.asset_identifier?.trim())
  if (candidates.length === 0) {
    return { results: [], positions }
  }
  const results: HealPendingNftNestResult[] = []
  let healedCount = 0

  for (const position of candidates) {
    if (healedCount >= HEAL_MAX_PER_REQUEST) break
    const pool = await getStakingPoolById(position.pool_id)
    if (!pool) continue

    if (!isPendingNftNestHealCandidate(position, pool)) continue

    const r = await tryHealPendingNftNestPosition(position, pool)
    results.push({
      positionId: position.id,
      healed: r.healed,
      error: r.error,
    })
    if (r.healed) healedCount += 1
  }

  const refreshed =
    healedCount > 0 ? await listStakingPositionsByWallet(wallet) : positions
  return { results, positions: refreshed }
}
