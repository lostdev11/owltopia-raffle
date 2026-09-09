/**
 * Which admin surface to show for a raffle detail page.
 * Milestone raffles need AdminRaffleActions (cancel, milestone escrow return, refunds)
 * even when no tickets are sold yet — EditRaffleForm only exposes main NFT return.
 */
const EDIT_FORM_SIMPLE_LIVE_STATUSES = new Set(['live', 'ready_to_draw', 'pending_min_not_met'])

export function shouldUseEditRaffleFormAdminView(params: {
  status: string | null | undefined
  hasConfirmedEntries: boolean
  milestoneCount: number
  /** When true, ended listings need AdminRaffleActions (min-threshold, force-cancel, refunds). */
  endTimePassed?: boolean
}): boolean {
  const status = (params.status ?? '').trim().toLowerCase()
  if (status === 'draft') {
    // Draft milestone raffles (or past end_time but never published) need escrow settle, not edit-only.
    if (params.milestoneCount > 0) return false
    if (params.endTimePassed) return false
    return true
  }
  // Any published milestone raffle needs operational admin (ended, live, cancelled, etc.).
  if (params.milestoneCount > 0) return false
  if (
    params.endTimePassed &&
    EDIT_FORM_SIMPLE_LIVE_STATUSES.has(status)
  ) {
    return false
  }
  if (
    (status === 'live' || status === 'ready_to_draw') &&
    !params.hasConfirmedEntries
  ) {
    return true
  }
  return false
}
