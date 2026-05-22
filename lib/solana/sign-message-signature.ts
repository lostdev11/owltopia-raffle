/**
 * Encode signMessage() output for SIWS / wallet-link / safeguards verify routes (base64, 64-byte ed25519).
 */
export function signMessageSignatureToBase64(signature: Uint8Array | string): string {
  if (signature instanceof Uint8Array) {
    return uint8ArrayToBase64(signature)
  }
  if (typeof signature === 'string') {
    const trimmed = signature.trim()
    if (!trimmed) throw new Error('Empty signature')
    try {
      const decoded = base64ToUint8Array(trimmed)
      if (decoded.length === 64) return trimmed
    } catch {
      /* not base64 — treat as raw byte string from wallet */
    }
    const bytes = Uint8Array.from(trimmed, (c) => c.charCodeAt(0))
    return uint8ArrayToBase64(bytes)
  }
  throw new Error('Unsupported signature type')
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'))
  }
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
