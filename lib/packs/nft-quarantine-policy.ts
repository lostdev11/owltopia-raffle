/** After this many payout failures, inventory is quarantined (status `removed`). */
export const PACK_NFT_PAYOUT_FAIL_QUARANTINE_THRESHOLD = 2

export function shouldQuarantinePackInventoryAfterPayoutFailure(failCount: number): boolean {
  return failCount >= PACK_NFT_PAYOUT_FAIL_QUARANTINE_THRESHOLD
}
