/**
 * Full admin may force-cancel live milestone raffles when the creator has not opened
 * a cancellation request (no request timestamp and no fee paid).
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
  if (status !== 'live' && status !== 'ready_to_draw') return false

  if ((params.winnerWallet ?? '').trim()) return false
  if ((params.winnerSelectedAt ?? '').trim()) return false

  return true
}
