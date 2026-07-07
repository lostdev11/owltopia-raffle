/** Configured on `staking_pools.nft_lock_standard`. */
export type NftLockStandard =
  | 'auto'
  | 'mpl_core_freeze_delegate'
  | 'spl_token_account_freeze'
  | 'database_only'

/** Resolved lock path used at runtime (never `auto`). */
export type ResolvedNftLockStandard = 'mpl_core_freeze_delegate' | 'spl_token_account_freeze' | 'database_only'

export type NestStakeExecutionPath =
  | 'onchain_nft_freeze_required'
  | 'onchain_nft_server_freeze'
  | 'database_mock'

export function isNftLockStandard(value: string | null | undefined): value is NftLockStandard {
  return (
    value === 'auto' ||
    value === 'mpl_core_freeze_delegate' ||
    value === 'spl_token_account_freeze' ||
    value === 'database_only'
  )
}

export function nestStakeExecutionPathForLock(
  standard: ResolvedNftLockStandard
): NestStakeExecutionPath {
  if (standard === 'database_only') return 'database_mock'
  if (standard === 'spl_token_account_freeze') return 'onchain_nft_server_freeze'
  return 'onchain_nft_freeze_required'
}

export function nestLockRequiresWalletSignature(standard: ResolvedNftLockStandard): boolean {
  return standard === 'mpl_core_freeze_delegate'
}
