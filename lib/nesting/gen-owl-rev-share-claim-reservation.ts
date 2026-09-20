/**
 * Whether it is safe to delete a reserved rev-share claim row after a failed payout.
 * Never release once a pool tx may have been submitted — Solana confirm can throw after land.
 */
export function shouldReleaseRevShareClaimReservation(payout: {
  sol_signature: string | null
  usdc_signature: string | null
  send_attempted: boolean
}): boolean {
  if (payout.sol_signature || payout.usdc_signature) return false
  return !payout.send_attempted
}
