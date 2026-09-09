/** Statuses where admin may force-cancel a milestone raffle (no creator request yet). */
export const ADMIN_FORCE_CANCEL_MILESTONE_STATUSES = [
  'live',
  'ready_to_draw',
  'pending_min_not_met',
] as const

/**
 * Full admin may force-cancel milestone raffles when the creator has not opened
 * a cancellation request (no request timestamp and no fee paid).
 * Includes ended / min-not-met states so support is not stuck on "ended" listings.
 */
export function canAdminForceCancelMilestoneRaffle(params: {
  status: string | null | undefined
  milestoneCount: number
  cancellationRequestedAt: string | null | undefined
  cancellationFeePaidAt: string | null | undefined
  cancelledAt: string | null | undefined
  winnerWallet: string | null | undefined
  winnerSelectedAt: string | null | undefined
}): boolean {
  if (params.milestoneCount <= 0) return false
  if (params.cancellationRequestedAt || params.cancellationFeePaidAt) return false
  if (params.cancelledAt) return false

  const status = (params.status ?? '').trim().toLowerCase()
  if (
    !ADMIN_FORCE_CANCEL_MILESTONE_STATUSES.includes(
      status as (typeof ADMIN_FORCE_CANCEL_MILESTONE_STATUSES)[number]
    )
  ) {
    return false
  }

  if ((params.winnerWallet ?? '').trim()) return false
  if ((params.winnerSelectedAt ?? '').trim()) return false

  return true
}
