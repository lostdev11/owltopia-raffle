import type { StakingPoolRow } from '@/lib/db/staking-pools'
import type { StakingPositionRow } from '@/lib/db/staking-positions'
import { StakingUserError } from '@/lib/nesting/errors'
import {
  assertWalletNftFrozenForNesting,
  readOwlClaimNftNestLockEligibilityWithRetry,
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

  const lockState = await readOwlClaimNftNestLockEligibilityWithRetry({
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

const CLAIM_ALL_LOCK_VERIFY_CONCURRENCY_DEFAULT = 3
const CLAIM_ALL_LOCK_CHUNK_DELAY_MS_DEFAULT = 200

function claimAllLockVerifyConcurrency(nestCount: number): number {
  if (nestCount <= 10) return CLAIM_ALL_LOCK_VERIFY_CONCURRENCY_DEFAULT
  if (nestCount <= 30) return 6
  return 8
}

function claimAllLockChunkDelayMs(nestCount: number): number {
  return nestCount > 30 ? 100 : CLAIM_ALL_LOCK_CHUNK_DELAY_MS_DEFAULT
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Batched on-chain lock checks for Claim all (limits RPC burst / 429 false failures). */
export async function verifyActiveNestLocksForClaimAll(
  positions: StakingPositionRow[],
  poolById: Map<string, StakingPoolRow>
): Promise<void> {
  const rowsToVerify = positions.filter((row) => {
    const pool = poolById.get(row.pool_id)
    return pool && positionRequiresOnChainNftFreezeLock(row, pool)
  })

  const concurrency = claimAllLockVerifyConcurrency(rowsToVerify.length)
  const chunkDelayMs = claimAllLockChunkDelayMs(rowsToVerify.length)

  for (let i = 0; i < rowsToVerify.length; i += concurrency) {
    if (i > 0) await sleepMs(chunkDelayMs)
    const chunk = rowsToVerify.slice(i, i + concurrency)
    await Promise.all(
      chunk.map(async (row) => {
        const rowPool = poolById.get(row.pool_id)
        if (!rowPool) {
          throw new StakingUserError('Pool not found', 400)
        }
        await assertActiveNftNestOnChainLock(row, rowPool, { allowOwnerThawedForClaim: true })
      })
    )
  }
}
