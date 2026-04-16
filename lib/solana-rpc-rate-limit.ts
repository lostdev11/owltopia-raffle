/**
 * Detect Solana HTTP / JSON-RPC quota errors (e.g. 429, -32429 "max usage reached").
 * Public RPCs and free tiers hit these under normal site traffic; wallets then fail balances + blockhash.
 */

export function isSolanaRpcRateLimitError(err: unknown): boolean {
  const fromObj =
    err &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
      ? (err as { message: string }).message
      : ''
  const msg = err instanceof Error ? err.message : fromObj
  let json = ''
  try {
    json = JSON.stringify(err ?? '')
  } catch {
    json = ''
  }
  const hay = `${msg} ${json}`.toLowerCase()
  return (
    hay.includes('429') ||
    hay.includes('-32429') ||
    hay.includes('max usage reached') ||
    hay.includes('too many requests') ||
    hay.includes('rate limit')
  )
}
