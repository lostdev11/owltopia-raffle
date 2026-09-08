/** JSON-RPC methods that fail on v1 txs unless maxSupportedTransactionVersion >= 1. */
export const VERSIONED_TX_READ_RPC_METHODS = new Set([
  'getTransaction',
  'getBlock',
  'getParsedTransaction',
])

/**
 * Ensure versioned-tx reads declare a decode ceiling of at least 1 (SIMD-0385).
 * Returns a shallow-copied request body; leaves unrelated methods alone.
 */
export function clampMaxSupportedTransactionVersion(body: unknown): unknown {
  const bump = (item: Record<string, unknown>): Record<string, unknown> => {
    const method = item.method
    if (typeof method !== 'string' || !VERSIONED_TX_READ_RPC_METHODS.has(method)) return item
    const params = Array.isArray(item.params) ? [...item.params] : []
    // getTransaction(sig, config?) / getParsedTransaction(sig, config?) / getBlock(slot, config?)
    const configIndex = 1
    const existing =
      params[configIndex] && typeof params[configIndex] === 'object' && !Array.isArray(params[configIndex])
        ? { ...(params[configIndex] as Record<string, unknown>) }
        : {}
    const current = existing.maxSupportedTransactionVersion
    const needsBump =
      current === undefined ||
      current === null ||
      current === 'legacy' ||
      current === '0' ||
      (typeof current === 'number' && current < 1)
    if (needsBump) {
      existing.maxSupportedTransactionVersion = 1
    }
    params[configIndex] = existing
    return { ...item, params }
  }

  if (Array.isArray(body)) {
    return body.map((item) =>
      item && typeof item === 'object' ? bump(item as Record<string, unknown>) : item
    )
  }
  if (body && typeof body === 'object') {
    return bump(body as Record<string, unknown>)
  }
  return body
}
