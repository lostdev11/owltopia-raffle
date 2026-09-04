import { Connection } from '@solana/web3.js'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { StakingUserError } from '@/lib/nesting/errors'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { nestingNftAssetLabels } from '@/lib/nesting/gen1-staking-pools'
import { detectResolvedNftLockStandardFromAsset } from '@/lib/nesting/nft-lock/detect-asset-standard'
import {
  isNftLockStandard,
  nestLockRequiresWalletSignature,
  nestStakeExecutionPathForLock,
  type NestStakeExecutionPath,
  type NftLockStandard,
  type ResolvedNftLockStandard,
} from '@/lib/nesting/nft-lock/types'
import {
  assertWalletNftFrozenForNesting as assertMplCoreWalletNftFrozen,
  assertNftAssetOwnedByWallet,
  getNestingNftFreezeDelegateAddress,
  isWalletNftFrozenForNestingDelegate as isMplCoreWalletNftFrozen,
  readOwlClaimNftNestLockEligibility,
  readOwlClaimNftNestLockEligibilityWithRetry,
  thawWalletNftForNesting as thawMplCoreWalletNft,
} from '@/lib/nesting/nft-freeze'
import {
  readNftStakeFreezeEligibility,
  type NftStakeEligibility,
  type NftStakeEligibilityCode,
  type WalletNestMintRow,
} from '@/lib/nesting/nft-stake-eligibility'
import {
  freezeSplTokenNestAccount,
  readSplTokenNestAccountState,
  thawSplTokenNestAccount,
  type SplTokenNestAccountState,
} from '@/lib/solana/spl-token-nest-lock'
import {
  detectSplNestFreezePath,
  detectSplNestFreezePathsBatch,
  freezeTokenMetadataNestAccount,
  thawTokenMetadataNestAccount,
  type SplNestFreezePath,
} from '@/lib/solana/token-metadata-nest-lock'

export type { NestStakeExecutionPath, NftLockStandard, ResolvedNftLockStandard }

export function poolConfiguredNftLockStandard(
  pool: Pick<StakingPoolRow, 'nft_lock_standard' | 'asset_type'>
): NftLockStandard {
  if (pool.asset_type !== 'nft') return 'database_only'
  const raw = pool.nft_lock_standard?.trim()
  if (raw && isNftLockStandard(raw)) return raw
  return 'auto'
}

export async function resolveEffectiveNftLockStandard(
  pool: Pick<StakingPoolRow, 'nft_lock_standard' | 'asset_type'>,
  assetId?: string | null
): Promise<ResolvedNftLockStandard> {
  const configured = poolConfiguredNftLockStandard(pool)
  if (configured !== 'auto') return configured
  if (assetId?.trim()) {
    const detected = await detectResolvedNftLockStandardFromAsset(assetId.trim())
    if (detected) return detected
  }
  return 'mpl_core_freeze_delegate'
}

export function nestExecutionForPool(
  pool: Pick<StakingPoolRow, 'nft_lock_standard' | 'asset_type' | 'adapter_mode'>,
  resolvedStandard?: ResolvedNftLockStandard
): {
  path: NestStakeExecutionPath
  requires_wallet_signature: boolean
  nft_lock_standard: ResolvedNftLockStandard
} {
  const standard =
    resolvedStandard ??
    (poolConfiguredNftLockStandard(pool) === 'auto'
      ? 'mpl_core_freeze_delegate'
      : (poolConfiguredNftLockStandard(pool) as ResolvedNftLockStandard))

  if (pool.asset_type !== 'nft' || pool.adapter_mode !== 'onchain_enabled') {
    return {
      path: 'database_mock',
      requires_wallet_signature: false,
      nft_lock_standard: standard,
    }
  }

  return {
    path: nestStakeExecutionPathForLock(standard),
    requires_wallet_signature: nestLockRequiresWalletSignature(standard),
    nft_lock_standard: standard,
  }
}

function mintCollectionFrozenMessage(): string {
  return (
    'This NFT is still frozen from its collection mint (for example Gen 2 mint-out freeze). ' +
    'Wait until the collection is thawed before nesting on Owltopia.'
  )
}

function splIncompatibleFreezeMessage(): string {
  return (
    'This NFT cannot use Owltopia nest locks (unsupported freeze authority). ' +
    'Contact support with the mint address if this is a partner collection.'
  )
}

function splStakeEligibilityFromPathState(entry: {
  path: SplNestFreezePath | null
  state: SplTokenNestAccountState
}): NftStakeEligibility {
  if (entry.state.heldByNestingLock) {
    return {
      eligible: false,
      reason:
        'This NFT is already locked for an Owltopia nest. Refresh My nest (or Finish opening) so the ledger can catch up — if it still blocks, contact support with this mint.',
      code: 'owltopia_lock_held',
    }
  }

  if (entry.state.isFrozen && !entry.state.heldByNestingLock) {
    return {
      eligible: false,
      reason: mintCollectionFrozenMessage(),
      code: 'mint_collection_frozen',
    }
  }

  if (!entry.path) {
    return {
      eligible: false,
      reason: splIncompatibleFreezeMessage(),
      code: 'incompatible_freeze_delegate',
    }
  }

  return { eligible: true }
}

async function readSplStakeEligibility(params: {
  assetId: string
  ownerWallet: string
  connection?: Connection
}): Promise<NftStakeEligibility> {
  try {
    const entry = await detectSplNestFreezePath({
      mint: params.assetId,
      ownerWallet: params.ownerWallet,
      connection: params.connection,
    })
    return splStakeEligibilityFromPathState(entry)
  } catch {
    return { eligible: true }
  }
}

export async function readNftStakeEligibilityForPool(params: {
  pool: Pick<StakingPoolRow, 'nft_lock_standard' | 'asset_type'> &
    Partial<Pick<StakingPoolRow, 'collection_key'>>
  assetId: string
  ownerWallet: string
  nestingDelegateAddress?: string | null
  connection?: Connection
}): Promise<NftStakeEligibility & { resolved_standard: ResolvedNftLockStandard }> {
  const resolved = await resolveEffectiveNftLockStandard(params.pool, params.assetId)
  if (resolved === 'database_only') {
    try {
      await assertNftAssetOwnedByWallet({
        assetId: params.assetId,
        ownerWallet: params.ownerWallet,
        collectionMint: params.pool.collection_key ?? null,
      })
      return { eligible: true, resolved_standard: resolved }
    } catch (e) {
      if (e instanceof StakingUserError) {
        return {
          eligible: false,
          reason: e.message,
          code: 'wrong_owner',
          resolved_standard: resolved,
        }
      }
      throw e
    }
  }
  if (resolved === 'spl_token_account_freeze') {
    const result = await readSplStakeEligibility({
      assetId: params.assetId,
      ownerWallet: params.ownerWallet,
      connection: params.connection,
    })
    return { ...result, resolved_standard: resolved }
  }
  const result = await readNftStakeFreezeEligibility({
    assetId: params.assetId,
    ownerWallet: params.ownerWallet,
    nestingDelegateAddress: params.nestingDelegateAddress,
  })
  return { ...result, resolved_standard: resolved }
}

export async function assertNftEligibleForPoolStake(params: {
  pool: StakingPoolRow
  assetId: string
  ownerWallet: string
}): Promise<ResolvedNftLockStandard> {
  const result = await readNftStakeEligibilityForPool({
    pool: params.pool,
    assetId: params.assetId,
    ownerWallet: params.ownerWallet,
  })
  if (!result.eligible) {
    throw new StakingUserError(result.reason, 400, {
      code: result.code as NftStakeEligibilityCode,
      asset_id: params.assetId.trim(),
      nft_lock_standard: result.resolved_standard,
    })
  }
  return result.resolved_standard
}

/** Max concurrent per-mint eligibility reads. Each mint costs 2–3 Solana RPC calls, so keep the
 * indexer/RPC fan-out bounded while still populating large wallets (e.g. Gen 2) far faster than serial. */
const WALLET_NEST_ENRICH_CONCURRENCY = 8

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const idx = next++
      results[idx] = await fn(items[idx]!, idx)
    }
  }
  const workers = Math.min(Math.max(1, concurrency), items.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}

function walletNestRowFromEligibility(
  row: { mint: string; name: string | null; image: string | null },
  result: NftStakeEligibility
): WalletNestMintRow {
  if (result.eligible) {
    return { ...row, stake_blocked: false, stake_block_reason: null, stake_block_code: null }
  }
  return {
    ...row,
    stake_blocked: true,
    stake_block_reason: result.reason,
    stake_block_code: result.code ?? null,
  }
}

export async function enrichWalletNestMintsForPool(
  pool: Pick<StakingPoolRow, 'nft_lock_standard' | 'asset_type'> &
    Partial<Pick<StakingPoolRow, 'collection_key'>>,
  mints: Array<{ mint: string; name: string | null; image: string | null }>,
  ownerWallet: string
): Promise<WalletNestMintRow[]> {
  if (mints.length === 0) return []
  const delegate = getNestingNftFreezeDelegateAddress()

  // Share one RPC connection across the batch so concurrent per-mint reads reuse keep-alive
  // sockets instead of each mint spinning up (and tearing down) its own Connection.
  const connection = new Connection(resolveServerSolanaRpcUrl(), { commitment: 'confirmed' })

  // Gen 2 / partner SPL perches: read the whole wallet in a few getMultipleAccounts calls
  // instead of 2–3 RPC round-trips per mint. Mints the batch could not read fall back below.
  const batched = new Map<string, WalletNestMintRow>()
  if (poolConfiguredNftLockStandard(pool) === 'spl_token_account_freeze') {
    try {
      const entries = await detectSplNestFreezePathsBatch({
        mints: mints.map((m) => m.mint),
        ownerWallet,
        connection,
      })
      for (const row of mints) {
        const entry = entries.get(row.mint.trim())
        if (!entry) continue
        batched.set(row.mint, walletNestRowFromEligibility(row, splStakeEligibilityFromPathState(entry)))
      }
    } catch {
      // Batch read failed entirely — per-mint fallback below covers every row.
    }
  }

  return mapWithConcurrency(mints, WALLET_NEST_ENRICH_CONCURRENCY, async (row) => {
    const fromBatch = batched.get(row.mint)
    if (fromBatch) return fromBatch
    const result = await readNftStakeEligibilityForPool({
      pool,
      assetId: row.mint,
      ownerWallet,
      nestingDelegateAddress: delegate,
      connection,
    })
    return walletNestRowFromEligibility(row, result)
  })
}

export async function assertWalletNftFrozenForPool(params: {
  pool: Pick<StakingPoolRow, 'nft_lock_standard' | 'asset_type' | 'collection_key' | 'slug'>
  ownerWallet: string
  assetId: string
  collectionMint?: string | null
}): Promise<{ tokenAccount: string; resolved_standard: ResolvedNftLockStandard }> {
  const resolved = await resolveEffectiveNftLockStandard(params.pool, params.assetId)
  if (resolved === 'database_only') {
    return { tokenAccount: params.assetId.trim(), resolved_standard: resolved }
  }
  if (resolved === 'spl_token_account_freeze') {
    const { path } = await detectSplNestFreezePath({
      mint: params.assetId,
      ownerWallet: params.ownerWallet,
    })
    if (path === 'freeze_delegated_account') {
      const frozen = await freezeTokenMetadataNestAccount({
        mint: params.assetId,
        ownerWallet: params.ownerWallet,
      })
      return { tokenAccount: frozen.tokenAccount, resolved_standard: resolved }
    }
    const frozen = await freezeSplTokenNestAccount({
      mint: params.assetId,
      ownerWallet: params.ownerWallet,
    })
    return { tokenAccount: frozen.tokenAccount, resolved_standard: resolved }
  }
  const frozen = await assertMplCoreWalletNftFrozen({
    ownerWallet: params.ownerWallet,
    assetId: params.assetId,
    collectionMint: params.collectionMint ?? params.pool.collection_key,
    assetSingular: nestingNftAssetLabels(params.pool).singular,
  })
  return { tokenAccount: frozen.tokenAccount, resolved_standard: resolved }
}

export async function thawWalletNftForPool(params: {
  pool: Pick<StakingPoolRow, 'nft_lock_standard' | 'asset_type' | 'collection_key'>
  ownerWallet: string
  assetId: string
  collectionMint?: string | null
  adminRecoveryUnstake?: boolean
}): Promise<{
  signature: string | null
  tokenAccount: string
  resolved_standard: ResolvedNftLockStandard
  /** Gen 2 FreezeDelegatedAccount path: holder should Revoke leftover SPL approve after thaw. */
  needsOwnerRevoke?: boolean
  revokeMint?: string
  /** MPL Core Owner freeze: holder must thaw via wallet (`updatePlugin frozen:false`). */
  needsOwnerThaw?: boolean
  thawMint?: string
}> {
  const resolved = await resolveEffectiveNftLockStandard(params.pool, params.assetId)
  if (resolved === 'database_only') {
    return { signature: null, tokenAccount: params.assetId.trim(), resolved_standard: resolved }
  }
  if (resolved === 'spl_token_account_freeze') {
    const { path, state } = await detectSplNestFreezePath({
      mint: params.assetId,
      ownerWallet: params.ownerWallet,
    })
    if (path === 'freeze_delegated_account' || state.nestingIsTokenDelegate) {
      const thawed = await thawTokenMetadataNestAccount({
        mint: params.assetId,
        ownerWallet: params.ownerWallet,
      })
      return {
        signature: thawed.signature,
        tokenAccount: thawed.tokenAccount,
        resolved_standard: resolved,
        needsOwnerRevoke: thawed.needsOwnerRevoke,
        revokeMint: thawed.needsOwnerRevoke ? params.assetId.trim() : undefined,
      }
    }
    const thawed = await thawSplTokenNestAccount({
      mint: params.assetId,
      ownerWallet: params.ownerWallet,
    })
    return { signature: thawed.signature, tokenAccount: thawed.tokenAccount, resolved_standard: resolved }
  }
  const thawed = await thawMplCoreWalletNft({
    ownerWallet: params.ownerWallet,
    assetId: params.assetId,
    collectionMint:
      params.adminRecoveryUnstake === true ? null : (params.collectionMint ?? params.pool.collection_key),
    adminRecoveryUnstake: params.adminRecoveryUnstake,
  })
  return {
    signature: thawed.signature,
    tokenAccount: thawed.tokenAccount,
    resolved_standard: resolved,
    needsOwnerThaw: thawed.needsOwnerThaw === true,
    thawMint: thawed.needsOwnerThaw === true ? params.assetId.trim() : undefined,
  }
}

export async function readNestLockEligibilityForPool(params: {
  pool: Pick<StakingPoolRow, 'nft_lock_standard' | 'asset_type'>
  assetId: string
  ownerWallet: string
  collectionMint?: string | null
}): Promise<{ locked: boolean; ownerThawedEligible: boolean } | null> {
  const resolved = await resolveEffectiveNftLockStandard(params.pool, params.assetId)
  if (resolved === 'database_only') return { locked: false, ownerThawedEligible: false }
  if (resolved === 'spl_token_account_freeze') {
    try {
      const state = await readSplTokenNestAccountState({
        mint: params.assetId,
        ownerWallet: params.ownerWallet,
      })
      return { locked: state.heldByNestingLock, ownerThawedEligible: false }
    } catch {
      return null
    }
  }
  return readOwlClaimNftNestLockEligibility({
    assetId: params.assetId,
    ownerWallet: params.ownerWallet,
    collectionMint: params.collectionMint,
  })
}

export async function readNestLockEligibilityForPoolWithRetry(
  params: {
    pool: Pick<StakingPoolRow, 'nft_lock_standard' | 'asset_type'>
    assetId: string
    ownerWallet: string
    collectionMint?: string | null
  },
  options?: { maxAttempts?: number }
): Promise<{ locked: boolean; ownerThawedEligible: boolean } | null> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 4)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const state = await readNestLockEligibilityForPool(params)
    if (state !== null) return state
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  return null
}

export async function isWalletNftFrozenForPool(params: {
  pool: Pick<StakingPoolRow, 'nft_lock_standard' | 'asset_type'>
  assetId: string
  ownerWallet?: string | null
  collectionMint?: string | null
}): Promise<boolean> {
  const resolved = await resolveEffectiveNftLockStandard(params.pool, params.assetId)
  if (resolved === 'database_only') return false
  if (resolved === 'spl_token_account_freeze') {
    if (!params.ownerWallet?.trim()) return false
    try {
      const state = await readSplTokenNestAccountState({
        mint: params.assetId,
        ownerWallet: params.ownerWallet,
      })
      return state.heldByNestingLock
    } catch {
      return false
    }
  }
  return isMplCoreWalletNftFrozen({
    assetId: params.assetId,
    ownerWallet: params.ownerWallet,
    collectionMint: params.collectionMint,
  })
}
