import { resolveMintOpensAt } from '@/lib/owl-center/launch-mint-config'
import { formatMintDate, formatPhaseStartShort, isPhaseOpenBySchedule } from '@/lib/owl-center/phase-schedule'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

/** True when PUBLIC mint is accepting wallets (phase live + schedule reached, not paused). */
export function isLaunchPublicMintOpenNow(
  launch: Pick<
    OwlCenterLaunchPublic,
    | 'active_phase'
    | 'active_phases'
    | 'status'
    | 'is_paused'
    | 'phase_schedule'
    | 'launch_deadline_at'
  >,
  nowMs: number = Date.now()
): boolean {
  if (launch.is_paused) return false
  if (launch.active_phase === 'SOLD_OUT' || launch.active_phase === 'TRADING_ACTIVE') return false
  if (launch.active_phase !== 'PUBLIC' && launch.status !== 'PUBLIC') return false
  return isPhaseOpenBySchedule(launch, 'PUBLIC', nowMs)
}

/** ISO when public mint opens (schedule or kickoff). */
export function getLaunchPublicMintOpensAt(
  launch: Pick<OwlCenterLaunchPublic, 'phase_schedule' | 'launch_deadline_at'>
): string | null {
  return resolveMintOpensAt(launch)
}

/** Hub / collection card CTA — don't say Mint Now before the scheduled public open. */
export function launchCollectionCtaLabel(
  launch: Pick<
    OwlCenterLaunchPublic,
    | 'active_phase'
    | 'active_phases'
    | 'status'
    | 'is_paused'
    | 'phase_schedule'
    | 'launch_deadline_at'
    | 'slug'
  >,
  nowMs: number = Date.now()
): string {
  if (launch.active_phase === 'TRADING_ACTIVE') return 'Trade Now'
  if (launch.active_phase === 'SOLD_OUT') return 'View Collection'
  if (launch.is_paused) return 'View Collection'
  if (launch.active_phase === 'PRESALE') return launch.slug === 'gen2' ? 'Mint Gen2' : 'Enter Presale'
  if (launch.active_phase === 'WHITELIST' || launch.active_phase === 'AIRDROP') return 'Mint Now'
  if (launch.active_phase === 'PUBLIC' || launch.status === 'PUBLIC') {
    if (!isPhaseOpenBySchedule(launch, 'PUBLIC', nowMs)) {
      const opens = getLaunchPublicMintOpensAt(launch)
      const short = formatPhaseStartShort(opens)
      return short ? `Opens ${short}` : 'Opens soon'
    }
    return 'Mint Now'
  }
  return 'View Collection'
}

/** Compact badge text when PUBLIC is approved but still waiting on schedule. */
export function launchPublicPhaseBadgeLabel(
  launch: Pick<
    OwlCenterLaunchPublic,
    'active_phase' | 'active_phases' | 'status' | 'phase_schedule' | 'launch_deadline_at'
  >,
  nowMs: number = Date.now()
): string | null {
  if (launch.active_phase !== 'PUBLIC' && launch.status !== 'PUBLIC') return null
  if (isPhaseOpenBySchedule(launch, 'PUBLIC', nowMs)) return null
  const opens = getLaunchPublicMintOpensAt(launch)
  const short = formatPhaseStartShort(opens)
  return short ? `Public · opens ${short}` : 'Public · scheduled'
}

export function launchScheduledPublicReason(
  launch: Pick<OwlCenterLaunchPublic, 'phase_schedule' | 'launch_deadline_at' | 'active_phases'>,
  nowMs: number = Date.now()
): string | null {
  if (isPhaseOpenBySchedule(launch, 'PUBLIC', nowMs)) return null
  const opens = getLaunchPublicMintOpensAt(launch)
  return opens
    ? `Public mint opens ${formatMintDate(opens)}`
    : 'Public mint is scheduled — open time not set yet'
}
