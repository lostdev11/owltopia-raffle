import type { StakingPositionRow } from '@/lib/db/staking-positions'
import type { StakingPoolRow } from '@/lib/db/staking-pools'

/** Active nest or in-progress open (pending) — not closed (`unstaked`). */
export function isOpenStakingPosition(pos: Pick<StakingPositionRow, 'status'>): boolean {
  return pos.status === 'active' || pos.status === 'pending'
}

/**
 * NFT is fully nested for gallery / picker — active, or pending after freeze confirmed.
 * Mid-open pending (before freeze) is excluded.
 */
export function isNftNestedForGallery(
  position: Pick<StakingPositionRow, 'status' | 'external_reference'>
): boolean {
  if (position.status === 'active') return true
  if (position.status === 'pending') {
    return (position.external_reference ?? '').startsWith('nft_freeze_confirmed:')
  }
  return false
}

/** Pending on-chain NFT nest before wallet freeze is confirmed — user may cancel without waiting for lock. */
export function isOpeningNftNestAbortable(
  position: Pick<StakingPositionRow, 'status' | 'external_reference'>,
  pool: Pick<StakingPoolRow, 'asset_type' | 'adapter_mode'>
): boolean {
  return (
    position.status === 'pending' &&
    pool.asset_type === 'nft' &&
    pool.adapter_mode === 'onchain_enabled' &&
    !(position.external_reference ?? '').startsWith('nft_freeze_confirmed:')
  )
}
