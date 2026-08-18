/** Partner-friendly labels for internal launch statuses (creator portal, not admin consoles). */

import { isPhaseOpenBySchedule, formatPhaseStartShort } from '@/lib/owl-center/phase-schedule'
import { getLaunchPublicMintOpensAt } from '@/lib/owl-center/launch-mint-open'

export type FriendlyLaunchStatus = {
  label: string
  /** Short "what happens next" hint for the creator. */
  hint: string | null
  tone: 'pending' | 'live' | 'done' | 'neutral'
}

export function friendlyLaunchStatus(
  status: string,
  activePhase?: string | null,
  opts?: {
    phase_schedule?: Partial<Record<string, string>> | null
    launch_deadline_at?: string | null
    active_phases?: string[] | null
    is_paused?: boolean
  }
): FriendlyLaunchStatus {
  const scheduleLaunch = {
    phase_schedule: (opts?.phase_schedule ?? {}) as Partial<Record<'PUBLIC', string>>,
    launch_deadline_at: opts?.launch_deadline_at ?? null,
    active_phases: (opts?.active_phases ?? []) as import('@/lib/owl-center/types').OwlCenterPhase[],
  }

  switch ((status || '').toUpperCase()) {
    case 'DRAFT':
      return { label: 'Draft', hint: 'Not submitted yet.', tone: 'neutral' }
    case 'PENDING_REVIEW':
      return {
        label: 'In review',
        hint: 'The Owltopia team is reviewing your collection — your mint page goes live here once approved.',
        tone: 'pending',
      }
    case 'PRESALE':
      return { label: 'Live — presale', hint: null, tone: 'live' }
    case 'WHITELIST':
      return { label: 'Live — whitelist mint', hint: null, tone: 'live' }
    case 'PUBLIC': {
      if (opts?.is_paused) {
        return { label: 'Paused', hint: 'Mint is paused — collectors cannot mint yet.', tone: 'pending' }
      }
      if (!isPhaseOpenBySchedule(scheduleLaunch, 'PUBLIC')) {
        const opens = getLaunchPublicMintOpensAt(scheduleLaunch)
        const short = formatPhaseStartShort(opens)
        return {
          label: short ? `Scheduled · opens ${short}` : 'Scheduled',
          hint: 'Public mint date is set — hub will show Open when that time is reached.',
          tone: 'pending',
        }
      }
      return { label: 'Live — public mint', hint: null, tone: 'live' }
    }
    case 'SOLD_OUT':
      return {
        label: 'Sold out',
        hint: 'Congrats! Marketplace listing tools are unlocked below.',
        tone: 'done',
      }
    case 'TRADING_ACTIVE':
      return { label: 'Trading live', hint: null, tone: 'done' }
    default: {
      const phase = (activePhase || '').trim()
      return { label: status || 'Unknown', hint: phase ? `Phase: ${phase}` : null, tone: 'neutral' }
    }
  }
}
