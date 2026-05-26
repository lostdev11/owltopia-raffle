import type { StakingPoolRow } from '@/lib/db/staking-pools'
import type { StakingPositionRow } from '@/lib/db/staking-positions'
import { StakingUserError } from '@/lib/nesting/errors'
import {
  assertWalletNftFrozenForNesting,
  readOwlClaimNftNestLockEligibility,
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
  /** Pay OWL rewards without forcing a wallet re-lock when the coin uses Owner freeze (thawed). */
  allowOwnerThawedForClaim?: boolean
}): Promise<void> {
  const assetId = params.assetId.trim()
  const ownerWallet = params.ownerWallet.trim()
  if (!assetId || !ownerWallet) {
    throw new StakingUserError('NFT asset id and wallet are required for nest lock checks.', 400)
  }

  if (params.repairMissingFreeze) {
    await assertWalletNftFrozenForNesting({
      ownerWallet,
      assetId,
      collectionMint: params.collectionMint,
    })
    return
  }

  const lockState = await readOwlClaimNftNestLockEligibility({
    assetId,
    ownerWallet,
    collectionMint: params.collectionMint,
  })
  if (lockState?.locked) return
  if (params.allowOwnerThawedForClaim && lockState?.ownerThawedEligible) return

  if (params.allowOwnerThawedForClaim && lockState === null) {
    throw new StakingUserError(
      'Unable to verify nest lock on-chain right now. Wait a moment and try Claim again, or claim from one nest at a time.',
      503,
      { code: 'nest_lock_read_failed', asset_id: assetId }
    )
  }

  throw new StakingUserError(
    'This Owl Nest coin is not locked on-chain, so it cannot earn or claim until the nest lock is restored. Finish opening the nest in your wallet, or contact support.',
    400
  )
}

export async function assertActiveNftNestOnChainLock(
  position: StakingPositionRow,
  pool: StakingPoolRow,
  options?: { repairMissingFreeze?: boolean; allowOwnerThawedForClaim?: boolean }
): Promise<void> {
  if (!positionRequiresOnChainNftFreezeLock(position, pool)) return
  await assertNftNestOnChainLockHeld({
    ownerWallet: position.wallet_address,
    assetId: position.asset_identifier!,
    collectionMint: pool.collection_key,
    repairMissingFreeze: options?.repairMissingFreeze ?? false,
    allowOwnerThawedForClaim: options?.allowOwnerThawedForClaim ?? false,
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
