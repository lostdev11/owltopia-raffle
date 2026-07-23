import type { StakingPositionRow } from '@/lib/db/staking-positions'
import {
  isNftNestPositionCountedAsNested,
  isPendingNftNestBeforeFreezeConfirmed,
} from '@/lib/nesting/position-lifecycle'

/** Active nests plus freeze-confirmed pending; opening pending stays out of `nested`. */
export function countNestedOwlCoinsForPool(
  positions: StakingPositionRow[],
  poolId: string
): { nested: number; opening: number } {
  let nested = 0
  let opening = 0
  const pid = poolId.trim()
  if (!pid) return { nested: 0, opening: 0 }
  for (const p of positions) {
    if (p.pool_id?.trim() !== pid) continue
    if (!p.asset_identifier?.trim()) continue
    if (isNftNestPositionCountedAsNested(p)) {
      nested++
      continue
    }
    if (isPendingNftNestBeforeFreezeConfirmed(p)) opening++
  }
  return { nested, opening }
}
