import type { PackVaultPayoutResult } from '@/lib/packs/vault'
import { isTransientSolanaRpcError } from '@/lib/solana/rpc-retry'

/** Payout / vault errors that should keep `paying_out` and return 503 retryable to the client. */
export function isPackPayoutTransientError(error: unknown): boolean {
  if (isTransientSolanaRpcError(error)) return true
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    msg.includes('blockhash') ||
    msg.includes('block height exceeded') ||
    msg.includes('transaction was not confirmed') ||
    msg.includes('confirmation timed out')
  )
}

export function isPackVaultPayoutResultRetryable(
  result: PackVaultPayoutResult
): result is Extract<PackVaultPayoutResult, { ok: false }> {
  if (result.ok) return false
  if (result.confirmUncertain) return true
  return isPackPayoutTransientError(new Error(result.error))
}
