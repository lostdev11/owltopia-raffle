/**
 * Guards for VRF draw concurrency: page auto-draw and cron can invoke selectWinner
 * at the same time. The winner update is idempotent; VRF metadata patches were not.
 */

export type RaffleDrawWinnerFields = {
  winner_wallet?: string | null
  winner_selected_at?: string | null
}

export type RaffleVrfAuditFields = RaffleDrawWinnerFields & {
  draw_vrf_requested_at?: string | null
  draw_seed?: string | null
  draw_ledger_hash?: string | null
  draw_sold_count?: number | null
  draw_vrf_request_tx?: string | null
  draw_vrf_fulfill_tx?: string | null
  draw_vrf_account?: string | null
}

export function raffleDrawWinnerAlreadySelected(
  raffle: RaffleDrawWinnerFields | null | undefined
): boolean {
  if (!raffle) return false
  if ((raffle.winner_wallet ?? '').trim()) return true
  if ((raffle.winner_selected_at ?? '').trim()) return true
  return false
}

/** True when stored VRF request timestamp is after winner selection (audit trail race). */
export function isVrfAuditMetadataSuspicious(
  raffle: RaffleVrfAuditFields | null | undefined
): boolean {
  if (!raffle) return false
  const winnerAt = Date.parse(String(raffle.winner_selected_at ?? ''))
  const vrfAt = Date.parse(String(raffle.draw_vrf_requested_at ?? ''))
  if (!Number.isFinite(winnerAt) || !Number.isFinite(vrfAt)) return false
  return vrfAt > winnerAt
}

/** Build a fulfilled VRF result from persisted draw fields (no chain I/O). */
export function fulfilledVrfResultFromStoredDraw(raffle: RaffleVrfAuditFields): {
  status: 'fulfilled'
  drawSeed: string
  ledgerHash: string
  soldCount: number
  fulfillTx: string
  requestTx: string
  randomnessAccount: string
} | null {
  const drawSeed = (raffle.draw_seed ?? '').trim()
  const ledgerHash = (raffle.draw_ledger_hash ?? '').trim()
  const soldCount = raffle.draw_sold_count
  if (!drawSeed || !ledgerHash || soldCount == null || soldCount <= 0) return null
  return {
    status: 'fulfilled',
    drawSeed,
    ledgerHash,
    soldCount,
    fulfillTx: (raffle.draw_vrf_fulfill_tx ?? '').trim(),
    requestTx: (raffle.draw_vrf_request_tx ?? '').trim(),
    randomnessAccount: (raffle.draw_vrf_account ?? '').trim(),
  }
}
