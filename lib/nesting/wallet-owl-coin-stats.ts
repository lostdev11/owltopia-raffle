import type { StakingPositionRow } from '@/lib/db/staking-positions'

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
    if (p.status === 'active') {
      nested++
      continue
    }
    if (p.status === 'pending') {
      if ((p.external_reference ?? '').startsWith('nft_freeze_confirmed:')) nested++
      else opening++
    }
  }
  return { nested, opening }
}
