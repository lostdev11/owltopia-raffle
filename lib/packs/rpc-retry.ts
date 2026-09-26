import { withSolanaRpcRetry } from '@/lib/solana/rpc-retry'

/** Retry budget for pack payment verify, VRF-adjacent reads, and vault payout send/confirm. */
export const PACK_SOLANA_RPC_RETRY = {
  retries: 5,
  baseDelayMs: 800,
  maxDelayMs: 12_000,
  jitter: true,
} as const

export async function withPackSolanaRpcRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withSolanaRpcRetry(fn, PACK_SOLANA_RPC_RETRY)
}
