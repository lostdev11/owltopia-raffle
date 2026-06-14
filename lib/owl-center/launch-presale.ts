import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

/** Launch uses a presale program (creator flag or non-zero presale cap). */
export function launchHasPresaleProgram(launch: Pick<OwlCenterLaunchPublic, 'creator_presale_enabled' | 'presale_supply'>): boolean {
  return Boolean(launch.creator_presale_enabled) || launch.presale_supply > 0
}

/** Show Presale+ overage row/bar — only when presale is active and overage pool > 0. */
export function launchShowsPresaleOverage(
  launch: Pick<OwlCenterLaunchPublic, 'creator_presale_enabled' | 'presale_supply' | 'presale_overage_supply'>
): boolean {
  return launchHasPresaleProgram(launch) && launch.presale_overage_supply > 0
}

export const DEFAULT_PRESALE_OVERAGE_SUPPLY = 13
