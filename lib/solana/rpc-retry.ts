/** Detect JSON-RPC / HTTP failures that are safe to retry on Solana reads and sends. */
export function isTransientSolanaRpcError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  const low = msg.toLowerCase()
  const code =
    (error as { code?: number })?.code ??
    (error as { error?: { code?: number } })?.error?.code

  return (
    code === 19 ||
    code === -32002 ||
    code === -32005 ||
    code === -32504 ||
    low.includes('504') ||
    low.includes('503') ||
    low.includes('502') ||
    low.includes('429') ||
    low.includes('timeout') ||
    low.includes('timed out') ||
    low.includes('failed to fetch') ||
    low.includes('networkerror') ||
    low.includes('network request failed') ||
    low.includes('temporary internal error') ||
    low.includes('econnreset') ||
    low.includes('socket hang up')
  )
}

export async function withSolanaRpcRetry<T>(
  fn: () => Promise<T>,
  options?: { retries?: number; baseDelayMs?: number }
): Promise<T> {
  const retries = Math.max(1, options?.retries ?? 3)
  const baseDelayMs = Math.max(100, options?.baseDelayMs ?? 1000)
  let lastError: unknown

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!isTransientSolanaRpcError(error) || attempt >= retries - 1) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (attempt + 1)))
    }
  }

  throw lastError
}

/** Heavier retry budget for candy-machine mint prep reads (mobile RPC is flaky). */
export const MINT_SOLANA_RPC_RETRY = { retries: 4, baseDelayMs: 800 } as const

/** Lighter retries for mint send — fail fast and recover on-chain instead of long RPC backoff. */
export const MINT_SOLANA_SEND_RETRY = { retries: 2, baseDelayMs: 350 } as const

export function friendlySolanaRpcErrorMessage(error: unknown): string | null {
  if (!isTransientSolanaRpcError(error)) return null
  return 'Could not reach Solana while preparing your mint — refresh the page, wait a few seconds, and tap Mint again. On mobile, try WiFi or switch to mobile data, then retry.'
}
