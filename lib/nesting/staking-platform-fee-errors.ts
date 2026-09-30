/**
 * Shared platform-fee verify error strings + client classification.
 * Keep messages stable — UI clears pending fees based on these.
 */

/** RPC has not indexed the fee tx yet (retry without re-paying). */
export const FEE_TX_NOT_FOUND_ERROR =
  'Fee transaction not found yet on-chain. Wait a moment and try again.'

/** Fee landed but failed (meta.err) — user must pay a new fee. */
export const FEE_TX_FAILED_ONCHAIN_ERROR =
  'Fee transaction failed on-chain. Approve a new platform fee and try again.'

/** Legacy combined message (pre-split). Treat as retryable lookup. */
export const FEE_TX_NOT_FOUND_OR_FAILED_LEGACY_ERROR =
  'Fee transaction not found or failed on-chain. Wait a moment and try again.'

export function isRetryableFeeTxLookupError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('not found yet on-chain') ||
    m.includes('not found or failed on-chain') ||
    (m.includes('wait a moment') && m.includes('fee transaction'))
  )
}

/** Hard failures: clear localStorage pending fee so the user can pay again. */
export function isHardPlatformFeeFailureError(message: string): boolean {
  const m = message.toLowerCase()
  if (isRetryableFeeTxLookupError(message)) return false
  return (
    m.includes('failed on-chain') ||
    m.includes('was not signed by your connected wallet') ||
    m.includes('treasury was not credited') ||
    m.includes('platform fee too low') ||
    m.includes('whole multiple of the per-nest fee') ||
    m.includes('belongs to a different wallet') ||
    m.includes('used for a different nest action') ||
    m.includes('send a new fee transaction') ||
    (m.includes('covers') && m.includes('but this action needs')) ||
    (m.includes('covers') && m.includes('already linked'))
  )
}
