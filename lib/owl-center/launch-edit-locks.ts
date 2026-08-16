import { isLaunchRoyaltyLocked } from '@/lib/owl-center/royalty'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

/**
 * Supply / mint-standard / freeze are editable by creators until Candy Machine
 * exists or any mints are recorded — after that on-chain size is fixed.
 */
export function isLaunchSupplyConfigLocked(
  launch: Pick<
    OwlCenterLaunchPublic,
    'candy_machine_id' | 'devnet_candy_machine_id' | 'minted_count'
  >
): boolean {
  if (isLaunchRoyaltyLocked(launch)) return true
  return Number(launch.minted_count ?? 0) > 0
}
