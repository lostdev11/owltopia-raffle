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
  resolveEffectiveNftLockStandard,
} from '@/lib/nesting/nft-lock-service'
import { readSplTokenNestAccountStatesBatch } from '@/lib/solana/spl-token-nest-lock'
import { Connection, PublicKey } from '@solana/web3.js'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

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

const CLAIM_ALL_LOCK_ACCOUNT_CHUNK = 100
const CLAIM_ALL_LOCK_VERIFY_CONCURRENCY_DEFAULT = 8

function claimAllLockVerifyConcurrency(nestCount: number): number {
  if (nestCount <= 10) return 3
  if (nestCount <= 30) return 6
  return CLAIM_ALL_LOCK_VERIFY_CONCURRENCY_DEFAULT
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

function isTransientClaimAllLockError(e: StakingUserError): boolean {
  if (e.status === 503) return true
  const code = typeof e.extra?.code === 'string' ? e.extra.code : ''
  return code === 'nest_lock_read_failed'
}

type ClaimAllLockOutcome =
  | { row: StakingPositionRow; kind: 'eligible' }
  | { row: StakingPositionRow; kind: 'skip'; skip: ClaimAllLockSkip }
  | { row: StakingPositionRow; kind: 'transient'; skip: ClaimAllLockSkip }

async function verifyClaimAllNestLockOutcome(
  row: StakingPositionRow,
  poolById: Map<string, StakingPoolRow>
): Promise<ClaimAllLockOutcome> {
  const rowPool = poolById.get(row.pool_id)
  if (!rowPool) {
    return {
      row,
      kind: 'skip',
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
    return { row, kind: 'eligible' }
  } catch (e) {
    if (isStakingUserError(e)) {
      const skip: ClaimAllLockSkip = {
        positionId: row.id,
        assetId: row.asset_identifier?.trim() || null,
        message: e.message,
        status: e.status,
        code: typeof e.extra?.code === 'string' ? e.extra.code : undefined,
      }
      if (isTransientClaimAllLockError(e)) {
        return { row, kind: 'transient', skip }
      }
      return { row, kind: 'skip', skip }
    }
    throw e
  }
}

async function accountExistsByAssetId(assetIds: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>()
  if (assetIds.length === 0) return out
  const connection = new Connection(resolveServerSolanaRpcUrl(), { commitment: 'confirmed' })
  const entries: Array<{ assetId: string; pk: PublicKey }> = []
  for (const raw of assetIds) {
    const assetId = raw.trim()
    if (!assetId) continue
    try {
      entries.push({ assetId, pk: new PublicKey(assetId) })
    } catch {
      out.set(assetId, false)
    }
  }
  for (let i = 0; i < entries.length; i += CLAIM_ALL_LOCK_ACCOUNT_CHUNK) {
    const chunk = entries.slice(i, i + CLAIM_ALL_LOCK_ACCOUNT_CHUNK)
    try {
      const infos = await connection.getMultipleAccountsInfo(chunk.map((e) => e.pk))
      chunk.forEach((entry, idx) => {
        out.set(entry.assetId, Boolean(infos[idx]))
      })
    } catch {
      for (const entry of chunk) {
        out.set(entry.assetId, true)
      }
    }
  }
  return out
}

async function verifySplClaimAllNestLockOutcomesBatch(
  rows: StakingPositionRow[],
  poolById: Map<string, StakingPoolRow>
): Promise<ClaimAllLockOutcome[]> {
  if (rows.length === 0) return []
  const byWallet = new Map<string, StakingPositionRow[]>()
  for (const row of rows) {
    const w = row.wallet_address.trim()
    if (!w) continue
    const list = byWallet.get(w) ?? []
    list.push(row)
    byWallet.set(w, list)
  }

  const outcomes: ClaimAllLockOutcome[] = []
  for (const [ownerWallet, walletRows] of byWallet) {
    const mints = walletRows
      .map((r) => r.asset_identifier?.trim())
      .filter((m): m is string => Boolean(m))
    const states = await readSplTokenNestAccountStatesBatch({ mints, ownerWallet })
    for (const row of walletRows) {
      const mint = row.asset_identifier?.trim() ?? ''
      const state = mint ? states.get(mint) : undefined
      if (!state) {
        outcomes.push({
          row,
          kind: 'transient',
          skip: {
            positionId: row.id,
            assetId: mint || null,
            message: 'Unable to verify nest lock on-chain right now.',
            status: 503,
            code: 'nest_lock_read_failed',
          },
        })
        continue
      }
      if (state.heldByNestingLock) {
        outcomes.push({ row, kind: 'eligible' })
        continue
      }
      outcomes.push({
        row,
        kind: 'skip',
        skip: {
          positionId: row.id,
          assetId: mint || null,
          message:
            'This nest is not locked on-chain, so it cannot earn or claim until the nest lock is restored. Finish opening the nest in your wallet, or contact support.',
          status: 400,
          code: 'nest_lock_ineligible',
        },
      })
    }
  }
  return outcomes
}

async function verifyClaimAllNestLocksInChunks(
  rows: StakingPositionRow[],
  poolById: Map<string, StakingPoolRow>,
  options?: { concurrency?: number }
): Promise<ClaimAllLockOutcome[]> {
  if (rows.length === 0) return []

  const splRows: StakingPositionRow[] = []
  const otherRows: StakingPositionRow[] = []
  for (const row of rows) {
    const pool = poolById.get(row.pool_id)
    if (!pool) {
      otherRows.push(row)
      continue
    }
    const resolved = await resolveEffectiveNftLockStandard(pool, row.asset_identifier ?? '')
    if (resolved === 'spl_token_account_freeze') {
      splRows.push(row)
    } else {
      otherRows.push(row)
    }
  }

  const outcomes: ClaimAllLockOutcome[] = []
  if (splRows.length > 0) {
    outcomes.push(...(await verifySplClaimAllNestLockOutcomesBatch(splRows, poolById)))
  }

  if (otherRows.length > 0) {
    const assetIds = otherRows
      .map((r) => r.asset_identifier?.trim())
      .filter((id): id is string => Boolean(id))
    const exists = await accountExistsByAssetId(assetIds)
    const concurrency = options?.concurrency ?? claimAllLockVerifyConcurrency(otherRows.length)
    for (let i = 0; i < otherRows.length; i += concurrency) {
      if (i > 0) await sleepMs(80)
      const chunk = otherRows.slice(i, i + concurrency)
      const chunkOutcomes = await Promise.all(
        chunk.map(async (row) => {
          const assetId = row.asset_identifier?.trim() ?? ''
          if (assetId && exists.get(assetId) === false) {
            return {
              row,
              kind: 'skip' as const,
              skip: {
                positionId: row.id,
                assetId,
                message:
                  'This nest is not locked on-chain, so it cannot earn or claim until the nest lock is restored. Finish opening the nest in your wallet, or contact support.',
                status: 400,
                code: 'nest_lock_ineligible',
              },
            }
          }
          return verifyClaimAllNestLockOutcome(row, poolById)
        })
      )
      outcomes.push(...chunkOutcomes)
    }
  }

  return outcomes
}

/**
 * Claim all: verify locks per nest. Unlocked / unfinished nests are skipped so one bad perch
 * does not block OWL payout for the rest (fee already paid for the full set still covers).
 *
 * Transient RPC / lock-read failures must NOT be treated as unlocked skips — that silently
 * underpays Claim all (user pays fee for N nests, receives OWL for N−k). Retry once, then abort.
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

  const eligible: StakingPositionRow[] = [...noVerifyNeeded]
  const skipped: ClaimAllLockSkip[] = []

  let outcomes = await verifyClaimAllNestLocksInChunks(rowsToVerify, poolById)
  let transientRows = outcomes.filter((o) => o.kind === 'transient').map((o) => o.row)

  // Second pass: serial-ish retry for RPC flakes so large wallets are not underpaid.
  if (transientRows.length > 0) {
    await sleepMs(600)
    const retryOutcomes = await verifyClaimAllNestLocksInChunks(transientRows, poolById, {
      concurrency: Math.min(3, claimAllLockVerifyConcurrency(transientRows.length)),
    })
    const byId = new Map(outcomes.map((o) => [o.row.id, o]))
    for (const o of retryOutcomes) {
      byId.set(o.row.id, o)
    }
    outcomes = [...byId.values()]
    transientRows = outcomes.filter((o) => o.kind === 'transient').map((o) => o.row)
  }

  if (transientRows.length > 0) {
    const sample = outcomes.find((o) => o.kind === 'transient' && o.row.id === transientRows[0]!.id)
    const sampleMessage =
      sample && sample.kind === 'transient' ? sample.skip.message.trim() : ''
    throw new StakingUserError(
      sampleMessage
        ? `${sampleMessage} Could not verify ${transientRows.length} nest${transientRows.length === 1 ? '' : 's'} — no OWL was sent. Wait a moment and tap Claim all again (your platform fee can be reused).`
        : `Could not verify nest lock for ${transientRows.length} nest${transientRows.length === 1 ? '' : 's'} (RPC busy). No OWL was sent — wait a moment and tap Claim all again (your platform fee can be reused).`,
      503,
      {
        code: 'claim_all_lock_read_failed',
        failed_count: transientRows.length,
        failed_position_ids: transientRows.map((r) => r.id),
      }
    )
  }

  for (const outcome of outcomes) {
    if (outcome.kind === 'eligible') eligible.push(outcome.row)
    else if (outcome.kind === 'skip') skipped.push(outcome.skip)
  }

  return { eligible, skipped }
}
