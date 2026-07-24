import bs58 from 'bs58'

/** Normalize UMI / wallet send results to a base58 transaction signature. */
export function umiSignatureToBase58(result: unknown): string {
  const sig =
    result && typeof result === 'object' && 'signature' in result
      ? (result as { signature: unknown }).signature
      : result
  if (sig instanceof Uint8Array) return bs58.encode(sig)
  if (Array.isArray(sig) && sig.every((n) => typeof n === 'number')) {
    return bs58.encode(Uint8Array.from(sig as number[]))
  }
  if (typeof sig === 'string' && sig.trim()) {
    // Comma-separated byte string from String(Uint8Array) — recover base58.
    if (/^\d+(,\d+)+$/.test(sig.trim())) {
      const bytes = sig.split(',').map((p) => Number(p))
      if (bytes.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
        return bs58.encode(Uint8Array.from(bytes))
      }
    }
    return sig.trim()
  }
  return String(sig ?? '')
}
