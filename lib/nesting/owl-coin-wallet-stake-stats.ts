import type { StakingPositionRow } from '@/lib/db/staking-positions'
import { getGenOwlGroupKeyForPoolSlug, resolveGenOwlGroupKey } from '@/lib/nesting/gen-owl-staking-groups'
import {
  defaultOwltopiaCoinPerch,
  findStakingPoolByIdOrSlug,
  isNftStakingPool,
} from '@/lib/nesting/format'

export function countNestedOwlCoinsForPool(positions: StakingPositionRow[], poolId: string): number {
  return countNestedNftsForPools(positions, [poolId])
}

export function countNestedNftsForPools(
  positions: StakingPositionRow[],
  poolIds: string[]
): number {
  const ids = new Set(poolIds.map((id) => id.trim()).filter(Boolean))
  if (ids.size === 0) return 0
  let count = 0
  for (const pos of positions) {
    if (!ids.has(pos.pool_id)) continue
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

/** Gen 1 / Gen 2 tiers share one collection — count nests across the whole group. */
export function poolIdsForNftWalletProgressStats(
  pools: { id: string; slug: string }[],
  poolId: string
): string[] {
  const pool = pools.find((p) => p.id === poolId.trim())
  if (!pool) return [poolId]
  const groupKey = getGenOwlGroupKeyForPoolSlug(pool.slug)
  if (!groupKey) return [pool.id]
  const tierIds = pools
    .filter((p) => getGenOwlGroupKeyForPoolSlug(p.slug) === groupKey)
    .map((p) => p.id)
  return tierIds.length > 0 ? tierIds : [pool.id]
}

/** Pick the NFT perch to measure wallet coverage against. */
export function resolveOwlCoinNftPoolId(
  pools: { id: string; slug: string; asset_type: string }[],
  options?: {
    preferredPoolId?: string | null
    preferredGroupKey?: string | null
    positionLockedPoolId?: string | null
  }
): string | null {
  const preferred = options?.preferredPoolId?.trim()
  if (preferred) {
    const match = findStakingPoolByIdOrSlug(pools, preferred)
    if (match && isNftStakingPool(match)) return match.id
  }
  const locked = options?.positionLockedPoolId?.trim()
  if (locked) {
    const match = findStakingPoolByIdOrSlug(pools, locked)
    if (match && isNftStakingPool(match)) return match.id
  }
  const groupKey = resolveGenOwlGroupKey(options?.preferredGroupKey)
  if (groupKey) {
    const tier = pools
      .filter((p) => isNftStakingPool(p) && getGenOwlGroupKeyForPoolSlug(p.slug) === groupKey)
      .sort((a, b) => a.slug.localeCompare(b.slug))[0]
    if (tier) return tier.id
  }
  const fallback = defaultOwltopiaCoinPerch(pools)
  return fallback?.id ?? null
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
  poolIds?: string[]
  positions: StakingPositionRow[]
  eligibleMintCount: number | null
  scanLoading: boolean
}): OwlCoinWalletStakeStats {
  const poolIds =
    input.poolIds && input.poolIds.length > 0 ? input.poolIds : [input.poolId]
  const nestedCount = countNestedNftsForPools(input.positions, poolIds)
  const totalCount =
    input.eligibleMintCount !== null ? nestedCount + input.eligibleMintCount : null
  return {
    nestedCount,
    totalCount,
    loading: input.scanLoading,
  }
}
