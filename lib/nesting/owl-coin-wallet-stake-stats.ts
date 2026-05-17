import type { StakingPositionRow } from '@/lib/db/staking-positions'

export function countNestedOwlCoinsForPool(positions: StakingPositionRow[], poolId: string): number {
  let count = 0
  for (const pos of positions) {
    if (pos.pool_id !== poolId) continue
    if (pos.status === 'active') {
      count++
      continue
    }
    if (
      pos.status === 'pending' &&
      (pos.external_reference ?? '').startsWith('nft_freeze_confirmed:')
    ) {
      count++
    }
  }
  return count
}

/** Pick the Owl Nest / Owltopia coin NFT perch to measure wallet coverage against. */
export function resolveOwlCoinNftPoolId(
  pools: { id: string; asset_type: string }[],
  options?: {
    preferredPoolId?: string | null
    positionLockedPoolId?: string | null
  }
): string | null {
  const preferred = options?.preferredPoolId?.trim()
  if (preferred) {
    const match = pools.find((p) => p.id === preferred)
    if (match?.asset_type === 'nft') return preferred
  }
  const locked = options?.positionLockedPoolId?.trim()
  if (locked) {
    const match = pools.find((p) => p.id === locked)
    if (match?.asset_type === 'nft') return locked
  }
  const nftPools = pools.filter((p) => p.asset_type === 'nft')
  if (nftPools.length === 1) return nftPools[0]!.id
  return null
}

export function positionLockedPoolIdFromRows(positions: StakingPositionRow[]): string | null {
  const ids = new Set<string>()
  for (const pos of positions) {
    if (pos.status !== 'active' && pos.status !== 'pending') continue
    const pid = pos.pool_id?.trim()
    if (pid) ids.add(pid)
  }
  if (ids.size !== 1) return null
  return [...ids][0]!
}

export type OwlCoinWalletStakeStats = {
  nestedCount: number
  totalCount: number | null
  loading: boolean
}

export function buildOwlCoinWalletStakeStats(input: {
  poolId: string
  positions: StakingPositionRow[]
  eligibleMintCount: number | null
  scanLoading: boolean
}): OwlCoinWalletStakeStats {
  const nestedCount = countNestedOwlCoinsForPool(input.positions, input.poolId)
  const totalCount =
    input.eligibleMintCount !== null ? nestedCount + input.eligibleMintCount : null
  return {
    nestedCount,
    totalCount,
    loading: input.scanLoading,
  }
}
