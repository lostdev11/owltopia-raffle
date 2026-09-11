import { isLaunchMarketplaceListingUnlockedWithCm as cmAwareUnlock } from '@/lib/owl-center/cm-supply-integrity'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { fetchCandyMachineOnChainSupply } from '@/lib/solana/candy-machine-supply'
import { getLaunchCandyMachineId, resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'

/** Minimal launch fields for marketplace gating (API rows may use plain strings). */
export type LaunchMarketplaceListingInput = {
  minted_count: number
  total_supply: number
  active_phase: string
  status: string
}

export type LaunchMarketplaceProgress = {
  minted: number
  total: number
  remaining: number
  percent_minted: number
}

export function getLaunchMarketplaceProgress(
  launch: Pick<OwlCenterLaunchPublic, 'minted_count' | 'total_supply'>
): LaunchMarketplaceProgress {
  const total = Math.max(0, launch.total_supply)
  const minted = Math.min(total, Math.max(0, launch.minted_count))
  const remaining = Math.max(0, total - minted)
  const percent_minted = total > 0 ? (minted / total) * 100 : 0
  return { minted, total, remaining, percent_minted }
}

export function isLaunchSupplyExhausted(
  launch: Pick<OwlCenterLaunchPublic, 'minted_count' | 'total_supply'>
): boolean {
  return launch.total_supply > 0 && launch.minted_count >= launch.total_supply
}

export function isLaunchSoldOutPhase(
  launch: Pick<LaunchMarketplaceListingInput, 'active_phase' | 'status'>
): boolean {
  return (
    launch.active_phase === 'SOLD_OUT' ||
    launch.status === 'SOLD_OUT' ||
    launch.active_phase === 'TRADING_ACTIVE' ||
    launch.status === 'TRADING_ACTIVE'
  )
}

/** Hash list, ME/Tensor listing fields, and trading activation (creator flow). */
export function isLaunchMarketplaceListingUnlocked(
  launch: LaunchMarketplaceListingInput
): boolean {
  return isLaunchSoldOutPhase(launch) || isLaunchSupplyExhausted(launch)
}

/**
 * Sold-out / DB-exhausted unlock, optionally gated on Candy Machine being fully redeemed.
 * Pass `cmFullyRedeemed=false` to block marketplace prep while CM still has unminted slots.
 * Pass `null` when CM supply is unknown (keeps legacy unlock).
 */
export function isLaunchMarketplaceListingUnlockedForCm(
  launch: LaunchMarketplaceListingInput,
  cmFullyRedeemed: boolean | null
): boolean {
  return cmAwareUnlock(isLaunchMarketplaceListingUnlocked(launch), cmFullyRedeemed)
}

/** Read whether the launch CM is fully redeemed (`null` if CM missing/unreadable). */
export async function resolveLaunchCmFullyRedeemed(
  launch: Pick<
    OwlCenterLaunchPublic,
    'slug' | 'mint_mode' | 'mint_network' | 'candy_machine_id' | 'devnet_candy_machine_id'
  >
): Promise<boolean | null> {
  const network = resolveLaunchMintNetwork(launch)
  const cmId = getLaunchCandyMachineId(launch, network)
  if (!cmId) return null
  const supply = await fetchCandyMachineOnChainSupply(cmId, network)
  if (!supply.ok) return null
  return supply.itemsLoaded > 0 && supply.remaining === 0
}
