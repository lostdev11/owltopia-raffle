/** Shown only after platform fee is confirmed and a background Claim-all job exists. */
export const CLAIM_ALL_CLOSE_PAGE_MESSAGE =
  'You can close this page — your claims will keep sending to your wallet.'

export function shouldShowClaimAllClosePageMessage(params: {
  phase: string
  hasActiveBackgroundJob: boolean
}): boolean {
  return params.hasActiveBackgroundJob && params.phase !== 'awaiting_wallet_signature'
}
