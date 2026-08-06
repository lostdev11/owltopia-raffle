import type { StakingPoolRow } from '@/lib/db/staking-pools'
import type { StakingPositionRow } from '@/lib/db/staking-positions'
import { markPositionUnstaked } from '@/lib/db/staking-positions'
import { StakingUserError, isStakingUserError } from '@/lib/nesting/errors'
import { nestingNftAssetLabels } from '@/lib/nesting/gen1-staking-pools'
import {
  assertWalletNftFrozenForNesting,
  assertNftAssetOwnedByWallet,
  readOwlClaimNftNestLockEligibilityWithRetry,
} from '@/lib/nesting/nft-freeze'
import {
  readNestLockEligibilityForPoolWithRetry,
  assertWalletNftFrozenForPool,
  poolConfiguredNftLockStandard,
} from '@/lib/nesting/nft-lock-service'

/** NFT perches that use MPL Core FreezeDelegate (holder wallet, non-transferable while nested). */
export function poolUsesOnChainNftFreezeLock(
  pool: Pick<StakingPoolRow, 'asset_type' | 'adapter_mode'>
): boolean {
  return pool.asset_type === 'nft' && pool.adapter_mode === 'onchain_enabled'
}

/** Soft nest: no on-chain freeze; NFT stays transferable; rewards gated by ownership. */
export function poolUsesSoftNftNest(
  pool: Pick<StakingPoolRow, 'asset_type' | 'nft_lock_standard' | 'adapter_mode'>
): boolean {
  if (pool.asset_type !== 'nft') return false
  if (poolUsesOnChainNftFreezeLock(pool)) return false
  return poolConfiguredNftLockStandard(pool) === 'database_only'
}

export function positionRequiresOnChainNftFreezeLock(
  position: Pick<StakingPositionRow, 'status' | 'asset_identifier'>,
  pool: Pick<StakingPoolRow, 'asset_type' | 'adapter_mode'>
): boolean {
  if (!poolUsesOnChainNftFreezeLock(pool)) return false
  if (position.status !== 'active') return false
  return Boolean(position.asset_identifier?.trim())
}

export function positionRequiresSoftNestOwnership(
  position: Pick<StakingPositionRow, 'status' | 'asset_identifier'>,
  pool: Pick<StakingPoolRow, 'asset_type' | 'nft_lock_standard' | 'adapter_mode'>
): boolean {
  if (!poolUsesSoftNftNest(pool)) return false
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
  pool?: Pick<StakingPoolRow, 'nft_lock_standard' | 'asset_type' | 'collection_key' | 'slug'> | null
  repairMissingFreeze?: boolean
  /** Pay OWL rewards without forcing a wallet re-lock when the coin uses Owner freeze (thawed). */
  allowOwnerThawedForClaim?: boolean
}): Promise<void> {
  const assetId = params.assetId.trim()
  const ownerWallet = params.ownerWallet.trim()
  if (!assetId || !ownerWallet) {
    throw new StakingUserError('NFT asset id and wallet are required for nest lock checks.', 400)
  }

  const pool = params.pool ?? null
  const assetSingular = nestingNftAssetLabels(pool).singular

  if (params.repairMissingFreeze) {
    if (pool) {
      await assertWalletNftFrozenForPool({
        pool,
        ownerWallet,
        assetId,
        collectionMint: params.collectionMint,
      })
    } else {
      await assertWalletNftFrozenForNesting({
        ownerWallet,
        assetId,
        collectionMint: params.collectionMint,
        assetSingular,
      })
    }
    return
  }

  const lockState = pool
    ? await readNestLockEligibilityForPoolWithRetry({
        pool,
        assetId,
        ownerWallet,
        collectionMint: params.collectionMint,
      })
    : await readOwlClaimNftNestLockEligibilityWithRetry({
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
    `This ${assetSingular} is not locked on-chain, so it cannot earn or claim until the nest lock is restored. Finish opening the nest in your wallet, or contact support.`,
    400
  )
}

export async function assertActiveNftNestOnChainLock(
  position: StakingPositionRow,
  pool: StakingPoolRow,
  options?: {
    repairMissingFreeze?: boolean
    allowOwnerThawedForClaim?: boolean
    /** Soft nests: require NFT still in wallet (default true). Pass false when closing/unstaking. */
    requireSoftOwnership?: boolean
    /** When soft nest NFT was transferred, close the DB position and rethrow. */
    closeSoftNestIfSold?: boolean
  }
): Promise<void> {
  const requireSoft = options?.requireSoftOwnership !== false
  if (requireSoft && positionRequiresSoftNestOwnership(position, pool)) {
    try {
      await assertNftAssetOwnedByWallet({
        assetId: position.asset_identifier!,
        ownerWallet: position.wallet_address,
        collectionMint: pool.collection_key,
      })
    } catch (e) {
      if (
        options?.closeSoftNestIfSold &&
        e instanceof StakingUserError &&
        e.extra?.code === 'soft_nest_ownership_lost'
      ) {
        try {
          await markPositionUnstaked(position.id, position.wallet_address, {
            external_reference: 'soft_nest_closed_ownership_lost',
          })
        } catch {
          /* best-effort close; still surface ownership error */
        }
      }
      throw e
    }
    return
  }

  if (!positionRequiresOnChainNftFreezeLock(position, pool)) return
  await assertNftNestOnChainLockHeld({
    ownerWallet: position.wallet_address,
    assetId: position.asset_identifier!,
    collectionMint: pool.collection_key,
    pool,
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
      'This nest perch must use on-chain NFT locks before new nests can open. Contact support.',
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
  const result = await partitionClaimAllNestsByLockEligibility(positions, poolById)
  if (result.skipped.length === 0) return
  const first = result.skipped[0]!
  throw new StakingUserError(first.message, first.status, {
    code: first.code ?? 'nest_lock_ineligible',
    asset_id: first.assetId,
    skipped_count: result.skipped.length,
    eligible_count: result.eligible.length,
  })
}

export type ClaimAllLockSkip = {
  positionId: string
  assetId: string | null
  message: string
  status: number
  code?: string
}

export type ClaimAllLockPartition = {
  eligible: StakingPositionRow[]
  skipped: ClaimAllLockSkip[]
}

/**
 * Claim all: verify locks per nest. Unlocked / unfinished nests are skipped so one bad perch
 * does not block OWL payout for the rest (fee already paid for the full set still covers).
 */
export async function partitionClaimAllNestsByLockEligibility(
  positions: StakingPositionRow[],
  poolById: Map<string, StakingPoolRow>
): Promise<ClaimAllLockPartition> {
  const rowsToVerify = positions.filter((row) => {
    const pool = poolById.get(row.pool_id)
    return (
      pool &&
      (positionRequiresOnChainNftFreezeLock(row, pool) || positionRequiresSoftNestOwnership(row, pool))
    )
  })
  const noVerifyNeeded = positions.filter((row) => !rowsToVerify.some((r) => r.id === row.id))

  const concurrency = claimAllLockVerifyConcurrency(rowsToVerify.length)
  const chunkDelayMs = claimAllLockChunkDelayMs(rowsToVerify.length)
  const eligible: StakingPositionRow[] = [...noVerifyNeeded]
  const skipped: ClaimAllLockSkip[] = []

  for (let i = 0; i < rowsToVerify.length; i += concurrency) {
    if (i > 0) await sleepMs(chunkDelayMs)
    const chunk = rowsToVerify.slice(i, i + concurrency)
    const outcomes = await Promise.all(
      chunk.map(async (row) => {
        const rowPool = poolById.get(row.pool_id)
        if (!rowPool) {
          return {
            row,
            ok: false as const,
            skip: {
              positionId: row.id,
              assetId: row.asset_identifier?.trim() || null,
              message: 'Pool not found',
              status: 400,
              code: 'pool_not_found',
            },
          }
        }
        try {
          await assertActiveNftNestOnChainLock(row, rowPool, {
            allowOwnerThawedForClaim: true,
            closeSoftNestIfSold: true,
          })
          return { row, ok: true as const }
        } catch (e) {
          if (isStakingUserError(e)) {
            return {
              row,
              ok: false as const,
              skip: {
                positionId: row.id,
                assetId: row.asset_identifier?.trim() || null,
                message: e.message,
                status: e.status,
                code: typeof e.extra?.code === 'string' ? e.extra.code : undefined,
              },
            }
          }
          throw e
        }
      })
    )
    for (const outcome of outcomes) {
      if (outcome.ok) eligible.push(outcome.row)
      else skipped.push(outcome.skip)
    }
  }

  return { eligible, skipped }
}
