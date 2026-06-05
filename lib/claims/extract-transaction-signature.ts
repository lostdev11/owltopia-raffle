/** Read a Solana transaction signature from common claim/refund API JSON shapes. */
export function extractTransactionSignature(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  const raw =
    (typeof o.transactionSignature === 'string' && o.transactionSignature) ||
    (typeof o.refundTxSignature === 'string' && o.refundTxSignature) ||
    (typeof o.refund_transaction_signature === 'string' && o.refund_transaction_signature) ||
    ''
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}
