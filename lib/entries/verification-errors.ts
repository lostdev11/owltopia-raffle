/**
 * Classify raffle entry verification errors for retry vs reject decisions.
 * Only definitive on-chain failures (meta.err) are safe to auto-reject — funds never moved.
 */

export function isTemporaryVerificationError(error: string | undefined | null): boolean {
  if (!error) return false
  return (
    error.includes('Transaction not found') ||
    error.includes('still be confirming') ||
    error.includes('temporary issue') ||
    error.includes('Verification error') ||
    error.includes('Transaction metadata not available')
  )
}

/** Transaction was found on-chain but reverted (meta.err set). Payment did not complete. */
export function isDefinitiveOnChainFailure(error: string | undefined | null): boolean {
  if (!error) return false
  return error.startsWith('Transaction failed on-chain:')
}
