import type { StakingPoolRow } from '@/lib/db/staking-pools'
import type { StakingPositionRow } from '@/lib/db/staking-positions'
import { StakingUserError } from '@/lib/nesting/errors'
import {
  assertWalletNftFrozenForNesting,
  isWalletNftFrozenForNestingDelegate,
} from '@/lib/nesting/nft-freeze'

/** NFT perches that use MPL Core FreezeDelegate (holder wallet, non-transferable while nested). */
export function poolUsesOnChainNftFreezeLock(
  pool: Pick<StakingPoolRow, 'asset_type' | 'adapter_mode'>
): boolean {
  return pool.asset_type === 'nft' && pool.adapter_mode === 'onchain_enabled'
}

export function positionRequiresOnChainNftFreezeLock(
  position: Pick<StakingPositionRow, 'status' | 'asset_identifier'>,
  pool: Pick<StakingPoolRow, 'asset_type' | 'adapter_mode'>
): boolean {
  if (!poolUsesOnChainNftFreezeLock(pool)) return false
  if (position.status !== 'active') return false
  return Boolean(position.asset_identifier?.trim())
}

/**
 * Ensures the Owltopia coin is still in the nest wallet and frozen under the nesting delegate.
 * When `repairMissingFreeze` is true, the server re-applies freeze if the delegate is set but thawed.
 */
export async function assertNftNestOnChainLockHeld(params: {
  ownerWallet: string
  assetId: string
  collectionMint?: string | null
  repairMissingFreeze?: boolean
}): Promise<void> {
  const assetId = params.assetId.trim()
  const ownerWallet = params.ownerWallet.trim()
  if (!assetId || !ownerWallet) {
    throw new StakingUserError('NFT asset id and wallet are required for nest lock checks.', 400)
  }

  const alreadyFrozen = await isWalletNftFrozenForNestingDelegate({
    assetId,
    collectionMint: params.collectionMint,
  })
  if (alreadyFrozen) return

  if (params.repairMissingFreeze) {
    await assertWalletNftFrozenForNesting({
      ownerWallet,
      assetId,
      collectionMint: params.collectionMint,
    })
    return
  }

  throw new StakingUserError(
    'This Owl Nest coin is not locked on-chain, so it cannot earn or claim until the nest lock is restored. Finish opening the nest in your wallet, or contact support.',
    400
  )
}

export async function assertActiveNftNestOnChainLock(
  position: StakingPositionRow,
  pool: StakingPoolRow,
  options?: { repairMissingFreeze?: boolean }
): Promise<void> {
  if (!positionRequiresOnChainNftFreezeLock(position, pool)) return
  await assertNftNestOnChainLockHeld({
    ownerWallet: position.wallet_address,
    assetId: position.asset_identifier!,
    collectionMint: pool.collection_key,
    repairMissingFreeze: options?.repairMissingFreeze ?? false,
  })
}

export function assertPoolConfiguredForOnChainNftFreeze(pool: StakingPoolRow): void {
  if (pool.asset_type !== 'nft') return
  const enforcement = (pool.lock_enforcement_source ?? 'database').trim()
  if (
    (enforcement === 'hybrid' || enforcement === 'onchain') &&
    !poolUsesOnChainNftFreezeLock(pool)
  ) {
    throw new StakingUserError(
      'This Owl Nest perch must use on-chain NFT locks before new nests can open. Contact support.',
      503
    )
  }
}
