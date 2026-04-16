import type { Connection } from '@solana/web3.js'

type TxResponse = NonNullable<Awaited<ReturnType<Connection['getTransaction']>>>

const cache = new Map<string, { tx: TxResponse; expiresAt: number }>()
const inflight = new Map<string, Promise<TxResponse | null>>()

/** Same confirmed tx body is immutable; reuse across duplicate verifications in a short window. */
const TX_CACHE_TTL_MS = 90_000

/**
 * Fetch a transaction once per signature per TTL, with concurrent request deduplication.
 * Does not cache negative results (tx still confirming) so retries behave normally.
 */
export async function getTransactionCached(
  signature: string,
  loader: () => Promise<TxResponse | null>
): Promise<TxResponse | null> {
  const now = Date.now()
  const hit = cache.get(signature)
  if (hit && hit.expiresAt > now) {
    return hit.tx
  }
  const pending = inflight.get(signature)
  if (pending) return pending

  const promise = (async () => {
    try {
      const tx = await loader()
      if (tx) {
        cache.set(signature, { tx, expiresAt: Date.now() + TX_CACHE_TTL_MS })
      }
      return tx
    } finally {
      inflight.delete(signature)
    }
  })()

  inflight.set(signature, promise)
  return promise
}
