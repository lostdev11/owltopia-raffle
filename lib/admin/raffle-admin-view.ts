/**
 * Which admin surface to show for a raffle detail page.
 * Milestone raffles need AdminRaffleActions (cancel, milestone escrow return, refunds)
 * even when no tickets are sold yet — EditRaffleForm only exposes main NFT return.
 */
export function shouldUseEditRaffleFormAdminView(params: {
  status: string | null | undefined
  hasConfirmedEntries: boolean
  milestoneCount: number
}): boolean {
  const status = (params.status ?? '').trim().toLowerCase()
  if (status === 'draft') return true
  if (
    (status === 'live' || status === 'ready_to_draw') &&
    !params.hasConfirmedEntries &&
    params.milestoneCount === 0
  ) {
    return true
  }
  return false
}
