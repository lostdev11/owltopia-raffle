import type { Raffle, RaffleStatus } from '@/lib/types'

/**
 * Statuses where full admins may push ticket payouts from FUNDS_ESCROW via legacy-escrow-refund
 * (same on-chain path as buyer "Claim refund"). Cancelled listings never reach `failed_refund_available`
 * but often still need escrow-driven refunds when ticket revenue sat in funds escrow.
 */
const ADMIN_FUNDS_ESCROW_REFUND_STATUSES: ReadonlySet<string> = new Set([
  'failed_refund_available',
  'cancelled',
])

/** Whether the admin "send refunds from funds escrow" tool may run for this raffle (UI + API). */
export function raffleAllowsAdminFundsEscrowRefund(raffle: { status: RaffleStatus }): boolean {
  const s = (raffle.status ?? '').toLowerCase()
  return ADMIN_FUNDS_ESCROW_REFUND_STATUSES.has(s)
}

/** Max automatic deadline extensions when min_tickets is not met at end; then refunds + NFT return. */
export const MAX_MIN_THRESHOLD_TIME_EXTENSIONS = 1

/** True when ticket gross must be verified as paid into the funds escrow wallet. */
export function raffleUsesFundsEscrow(raffle: {
  ticket_payments_to_funds_escrow?: boolean | null | string | number
}): boolean {
  const v = raffle.ticket_payments_to_funds_escrow
  // DB column is NOT NULL DEFAULT true (044). Missing/null in API payloads must match that default so
  // draw → `successful_pending_claims` and dashboard claim UI stay aligned with on-chain escrow routing.
  if (v === undefined || v === null) return true
  return v === true || v === 'true' || v === 1
}

/**
 * Live / ready-to-draw raffles included in the dashboard "Live claim tracker" gross/net/fee breakdown.
 * Uses funds escrow when the flag is on, or when legacy migration 044 left the flag false but every
 * confirmed sale was refunded (no unrefunded rows) — those raffles can be upgraded to escrow on next checkout.
 */
export function raffleCountsTowardLiveFundsEscrowBreakdown(
  row: { ticket_payments_to_funds_escrow?: boolean | null | string | number },
  raffleHasUnrefundedConfirmedEntry: boolean
): boolean {
  if (raffleUsesFundsEscrow(row)) return true
  const v = row.ticket_payments_to_funds_escrow
  const explicitFalse = v === false || v === 'false' || v === 0
  if (!explicitFalse) return true
  return !raffleHasUnrefundedConfirmedEntry
}

/** True after the raffle has already been extended the maximum times for min-threshold misses. */
export function hasExhaustedMinThresholdTimeExtensions(raffle: Raffle): boolean {
  const n = raffle.time_extension_count ?? 0
  return n >= MAX_MIN_THRESHOLD_TIME_EXTENSIONS
}

/** True after first time-extension (end_time extended past original_end_time). UI / diagnostics. */
export function hasRaffleAlreadyBeenTimeExtended(raffle: Raffle): boolean {
  const orig = raffle.original_end_time
  const end = raffle.end_time
  if (!orig || !end) return false
  const origMs = new Date(orig).getTime()
  const endMs = new Date(end).getTime()
  if (Number.isNaN(origMs) || Number.isNaN(endMs)) return false
  return endMs > origMs + 2_000
}
