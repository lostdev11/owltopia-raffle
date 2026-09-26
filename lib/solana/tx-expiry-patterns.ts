/** On-chain / RPC messages that mean the tx blockhash aged out before landing. */
export const BLOCKHASH_OR_TX_EXPIRY_PATTERNS = [
  'block height exceeded',
  'blockhash not found',
  'blockhash expired',
  'transaction expired',
  'signature has expired',
  'transaction was not confirmed',
] as const

/** Phantom / wallet UI copy when the user leaves the approve sheet open too long. */
export const WALLET_TX_EXPIRED_BEFORE_APPROVAL_PATTERNS = [
  'expired before it was approved',
  'wallet transaction expired',
] as const

export function isBlockhashOrTxExpiryError(error: unknown): boolean {
  const low = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    BLOCKHASH_OR_TX_EXPIRY_PATTERNS.some((p) => low.includes(p)) ||
    WALLET_TX_EXPIRED_BEFORE_APPROVAL_PATTERNS.some((p) => low.includes(p))
  )
}

export function isWalletUserRejectionError(error: unknown): boolean {
  const low = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    low.includes('user rejected') ||
    low.includes('rejected the request') ||
    low.includes('user denied') ||
    low.includes('approval denied') ||
    low.includes('wallet approval') ||
    low.includes('request rejected') ||
    (low.includes('cancel') && !low.includes('transaction'))
  )
}
