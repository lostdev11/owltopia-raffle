import { launchHasPresaleProgram, launchShowsPresaleOverage } from '@/lib/owl-center/launch-presale'
import type { OwlCenterLaunchPublic, OwlCenterPhase } from '@/lib/owl-center/types'

export type LaunchPhaseFilterInput = Pick<
  OwlCenterLaunchPublic,
  | 'airdrop_supply'
  | 'creator_presale_enabled'
  | 'presale_supply'
  | 'presale_overage_supply'
  | 'wl_supply'
  | 'public_supply'
>

/** Mint phases configured for this launch (always ends with TRADING_ACTIVE). */
export function launchConfiguredTimelinePhases(launch: LaunchPhaseFilterInput): OwlCenterPhase[] {
  const phases: OwlCenterPhase[] = []
  if (launch.airdrop_supply > 0) phases.push('AIRDROP')
  if (launchHasPresaleProgram(launch) && launch.presale_supply > 0) phases.push('PRESALE')
  if (launchShowsPresaleOverage(launch)) phases.push('PRESALE_OVERAGE')
  if (launch.wl_supply > 0) phases.push('WHITELIST')
  if (launch.public_supply > 0) phases.push('PUBLIC')
  phases.push('TRADING_ACTIVE')
  return phases
}

export function resolveLaunchTimelineIndex(phases: OwlCenterPhase[], active: OwlCenterPhase): number {
  const activeForIdx = active === 'SOLD_OUT' ? 'PUBLIC' : active
  const idx = phases.indexOf(activeForIdx)
  if (idx >= 0) return idx
  const tradingIdx = phases.indexOf('TRADING_ACTIVE')
  return tradingIdx > 0 ? tradingIdx - 1 : 0
}
