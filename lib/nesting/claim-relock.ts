/** True when claim API failed because the user must re-lock Owl Nest coins in the wallet first. */
export function stakingClaimResponseNeedsWalletRelock(
  json: { error?: string; code?: string } | null | undefined
): boolean {
  if (!json) return false
  if (json.code === 'nest_relock_required') return true
  return typeof json.error === 'string' && /re-locked from your wallet/i.test(json.error)
}
