import type { StakingPositionRow } from '@/lib/db/staking-positions'
import type { StakingPoolRow } from '@/lib/db/staking-pools'

/** Oldest nests first — used by heal/reconcile so early nesters are not starved by per-request caps. */
export function sortStakingPositionsOldestFirst<T extends { staked_at: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => new Date(a.staked_at).getTime() - new Date(b.staked_at).getTime()
  )
}

/** Active nest or in-progress open (pending) — not closed (`unstaked`). */
export function isOpenStakingPosition(pos: Pick<StakingPositionRow, 'status'>): boolean {
  return pos.status === 'active' || pos.status === 'pending'
}

/** Pending NFT nest before freeze is reflected in DB (`nft_freeze_confirmed:`). */
export function isPendingNftNestBeforeFreezeConfirmed(
  position: Pick<StakingPositionRow, 'status' | 'external_reference'>
): boolean {
  return (
    position.status === 'pending' &&
    !(position.external_reference ?? '').startsWith('nft_freeze_confirmed:')
  )
}

/** Freeze recorded in DB but row never promoted to `active` (manual patch / partial write). */
export function isPendingNftNestFreezeConfirmedButNotActive(
  position: Pick<StakingPositionRow, 'status' | 'external_reference'>
): boolean {
  return (
    position.status === 'pending' &&
    (position.external_reference ?? '').startsWith('nft_freeze_confirmed:')
  )
}

/**
 * Counts toward “nested” wallet coverage (progress bar, nestable filters, admin inventory).
 * Active nests and freeze-confirmed pending — opening pending before freeze does not count.
 */
export function isNftNestPositionCountedAsNested(
  position: Pick<StakingPositionRow, 'status' | 'external_reference'>
): boolean {
  if (position.status === 'active') return true
  return isPendingNftNestFreezeConfirmedButNotActive(position)
}

/** True when this mint has a counted-nested open position in any of the given pool ids. */
export function nftMintIsNestedInPools(
  mint: string,
  poolIds: string[],
  positions: Pick<
    StakingPositionRow,
    'pool_id' | 'asset_identifier' | 'status' | 'external_reference'
  >[]
): boolean {
  const trimmed = mint.trim()
  if (!trimmed) return false
  const ids = new Set(poolIds.map((id) => id.trim()).filter(Boolean))
  if (ids.size === 0) return false
  for (const p of positions) {
    if (!ids.has(p.pool_id)) continue
    if (p.asset_identifier?.trim() !== trimmed) continue
    if (isNftNestPositionCountedAsNested(p)) return true
  }
  return false
}

/**
 * Pending on-chain NFT nest before wallet freeze is confirmed — user may cancel without waiting for lock.
 * Also true for orphaned `awaiting_nft_freeze` rows that never completed the wallet lock step.
 */
export function isOpeningNftNestAbortable(
  position: Pick<StakingPositionRow, 'status' | 'external_reference'>,
  pool: Pick<StakingPoolRow, 'asset_type' | 'adapter_mode'>
): boolean {
  if (pool.asset_type !== 'nft' || !isPendingNftNestBeforeFreezeConfirmed(position)) {
    return false
  }
  if ((position.external_reference ?? '').trim() === 'awaiting_nft_freeze') {
    return true
  }
  return pool.adapter_mode === 'onchain_enabled'
}

/**
 * True when this mint cannot open another nest for `pool`: same rules as duplicate-stake rejection,
 * except a pending perch before NFT freeze confirms may still resume via the stake endpoint.
 */
export function nftMintBlocksDuplicateStakeExceptResume(
  mint: string,
  pool: Pick<StakingPoolRow, 'id' | 'asset_type' | 'adapter_mode'>,
  positions: Pick<StakingPositionRow, 'pool_id' | 'asset_identifier' | 'status' | 'external_reference'>[]
): boolean {
  const trimmed = mint.trim()
  if (!trimmed) return false
  for (const p of positions) {
    if (p.pool_id !== pool.id) continue
    const aid = p.asset_identifier?.trim()
    if (!aid || aid !== trimmed) continue
    if (!isOpenStakingPosition(p)) continue
    if (isOpeningNftNestAbortable(p, pool)) continue
    return true
  }
  return false
}
