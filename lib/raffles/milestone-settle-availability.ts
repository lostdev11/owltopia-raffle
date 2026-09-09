import { canAdminForceCancelMilestoneRaffle } from '@/lib/raffles/force-cancel-eligibility'
import { isMilestoneDepositReturnable } from '@/lib/raffles/milestones/return-eligibility'
import type { RaffleMilestone } from '@/lib/types'

export type AdminMilestoneSettleMode = 'force_cancel' | 'return_deposits' | 'unavailable'

export type AdminMilestoneSettleAvailability = {
  mode: AdminMilestoneSettleMode
  /** Why force-cancel / return is unavailable (full admin troubleshooting). */
  reason?: string
  returnableMilestoneCount: number
}

const FORCE_CANCEL_STATUSES = new Set([
  'draft',
  'live',
  'ready_to_draw',
  'pending_min_not_met',
])

export function countReturnableMilestoneDeposits(params: {
  milestones: Array<
    Pick<
      RaffleMilestone,
      'status' | 'deposit_verified_at' | 'returned_at' | 'return_tx' | 'prize_type'
    >
  >
  raffleStatus: string | null | undefined
}): number {
  return params.milestones.filter((m) =>
    isMilestoneDepositReturnable({ milestone: m, raffleStatus: params.raffleStatus })
  ).length
}

/**
 * What milestone escrow settle action full admin should offer on the raffle admin page.
 */
export function getAdminMilestoneSettleAvailability(params: {
  status: string | null | undefined
  milestones: Array<
    Pick<
      RaffleMilestone,
      'status' | 'deposit_verified_at' | 'returned_at' | 'return_tx' | 'prize_type'
    >
  >
  cancellationRequestedAt: string | null | undefined
  cancellationFeePaidAt: string | null | undefined
  cancelledAt: string | null | undefined
  winnerWallet: string | null | undefined
  winnerSelectedAt: string | null | undefined
}): AdminMilestoneSettleAvailability {
  const milestoneCount = params.milestones.length
  const returnableMilestoneCount = countReturnableMilestoneDeposits({
    milestones: params.milestones,
    raffleStatus: params.status,
  })

  if (milestoneCount === 0) {
    return {
      mode: 'unavailable',
      reason: 'No bonus milestones are saved on this raffle.',
      returnableMilestoneCount: 0,
    }
  }

  const status = (params.status ?? '').trim().toLowerCase()

  if (status === 'cancelled' || status === 'failed_refund_available') {
    if (returnableMilestoneCount > 0) {
      return { mode: 'return_deposits', returnableMilestoneCount }
    }
    return {
      mode: 'unavailable',
      reason:
        'Raffle is already in a terminal refund state, but no funded milestone deposits remain to return.',
      returnableMilestoneCount: 0,
    }
  }

  if (
    canAdminForceCancelMilestoneRaffle({
      status: params.status,
      milestoneCount,
      cancellationRequestedAt: params.cancellationRequestedAt,
      cancellationFeePaidAt: params.cancellationFeePaidAt,
      cancelledAt: params.cancelledAt,
      winnerWallet: params.winnerWallet,
      winnerSelectedAt: params.winnerSelectedAt,
    })
  ) {
    return { mode: 'force_cancel', returnableMilestoneCount }
  }

  if (params.cancellationRequestedAt || params.cancellationFeePaidAt) {
    return {
      mode: 'unavailable',
      reason:
        'Creator already requested cancellation — scroll to Admin actions and use Accept cancellation.',
      returnableMilestoneCount,
    }
  }

  if ((params.winnerWallet ?? '').trim() || (params.winnerSelectedAt ?? '').trim()) {
    return {
      mode: 'unavailable',
      reason: 'A winner is already on file; milestone escrow cannot be force-cancelled.',
      returnableMilestoneCount,
    }
  }

  if (params.cancelledAt) {
    return {
      mode: 'unavailable',
      reason: 'Raffle is already cancelled.',
      returnableMilestoneCount,
    }
  }

  if (!FORCE_CANCEL_STATUSES.has(status)) {
    return {
      mode: 'unavailable',
      reason: `Database status is "${status || 'unknown'}". Cancel & return supports draft (never published), live, ready_to_draw, and pending_min_not_met.`,
      returnableMilestoneCount,
    }
  }

  return {
    mode: 'unavailable',
    reason: 'Milestone settle is not available for this raffle state.',
    returnableMilestoneCount,
  }
}
