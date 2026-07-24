import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { StakingUserError } from '@/lib/nesting/errors'
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
} from '@/lib/solana/spl-token-nest-lock'

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
    'This NFT mint freeze authority is not assigned to Owltopia nesting yet. ' +
    'Partner collections must delegate freeze authority to the nesting authority before holders can nest.'
  )
}

async function readSplStakeEligibility(params: {
  assetId: string
  ownerWallet: string
}): Promise<NftStakeEligibility> {
  try {
    const state = await readSplTokenNestAccountState({
      mint: params.assetId,
      ownerWallet: params.ownerWallet,
    })

    if (state.heldByNestingLock) {
      return {
        eligible: false,
        reason:
          'This NFT is already locked for an Owltopia nest. Refresh My nest (or Finish opening) so the ledger can catch up — if it still blocks, contact support with this mint.',
        code: 'owltopia_lock_held',
      }
    }

    if (state.isFrozen && !state.heldByNestingLock) {
      return {
        eligible: false,
        reason: mintCollectionFrozenMessage(),
        code: 'mint_collection_frozen',
      }
    }

    if (!state.nestingAuthorityCanFreeze) {
      return {
        eligible: false,
        reason: splIncompatibleFreezeMessage(),
        code: 'incompatible_freeze_delegate',
      }
    }

    return { eligible: true }
  } catch {
    return { eligible: true }
  }
}

export async function readNftStakeEligibilityForPool(params: {
  pool: Pick<StakingPoolRow, 'nft_lock_standard' | 'asset_type'>
  assetId: string
  ownerWallet: string
  nestingDelegateAddress?: string | null
}): Promise<NftStakeEligibility & { resolved_standard: ResolvedNftLockStandard }> {
  const resolved = await resolveEffectiveNftLockStandard(params.pool, params.assetId)
  if (resolved === 'database_only') {
    return { eligible: true, resolved_standard: resolved }
  }
  if (resolved === 'spl_token_account_freeze') {
    const result = await readSplStakeEligibility({
      assetId: params.assetId,
      ownerWallet: params.ownerWallet,
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

export async function enrichWalletNestMintsForPool(
  pool: Pick<StakingPoolRow, 'nft_lock_standard' | 'asset_type'>,
  mints: Array<{ mint: string; name: string | null; image: string | null }>,
  ownerWallet: string
): Promise<WalletNestMintRow[]> {
  if (mints.length === 0) return []
  const delegate = getNestingNftFreezeDelegateAddress()

  const out: WalletNestMintRow[] = []
  for (const row of mints) {
    const result = await readNftStakeEligibilityForPool({
      pool,
      assetId: row.mint,
      ownerWallet,
      nestingDelegateAddress: delegate,
    })
    if (result.eligible) {
      out.push({ ...row, stake_blocked: false, stake_block_reason: null, stake_block_code: null })
    } else {
      out.push({
        ...row,
        stake_blocked: true,
        stake_block_reason: result.reason,
        stake_block_code: result.code ?? null,
      })
    }
  }
  return out
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
}): Promise<{ signature: string | null; tokenAccount: string; resolved_standard: ResolvedNftLockStandard }> {
  const resolved = await resolveEffectiveNftLockStandard(params.pool, params.assetId)
  if (resolved === 'database_only') {
    return { signature: null, tokenAccount: params.assetId.trim(), resolved_standard: resolved }
  }
  if (resolved === 'spl_token_account_freeze') {
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
  return { signature: thawed.signature, tokenAccount: thawed.tokenAccount, resolved_standard: resolved }
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
