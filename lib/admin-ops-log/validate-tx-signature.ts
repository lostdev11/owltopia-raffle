import bs58 from 'bs58'

export type TxSignatureValidation =
  | { ok: true; normalized: string }
  | { ok: false; error: string }

/** Validates optional Solana transaction signature (base58, ~88 chars). Empty is allowed. */
export function validateOptionalSolanaTxSignature(raw: unknown): TxSignatureValidation | { ok: true; normalized: null } {
  if (raw === undefined || raw === null) return { ok: true, normalized: null }
  if (typeof raw !== 'string') return { ok: false, error: 'Tx signature must be a string' }
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, normalized: null }
  if (trimmed.length < 80 || trimmed.length > 120) {
    return { ok: false, error: 'Tx signature must look like a Solana signature (length).' }
  }
  try {
    const decoded = bs58.decode(trimmed)
    if (decoded.length !== 64) {
      return { ok: false, error: 'Tx signature must decode to 64 bytes.' }
    }
  } catch {
    return { ok: false, error: 'Tx signature must be valid base58.' }
  }
  return { ok: true, normalized: trimmed }
}

export function isLikelyRealTxSignature(value: string | null | undefined): boolean {
  if (value == null) return false
  const t = value.trim()
  if (t.length < 32) return false
  return validateOptionalSolanaTxSignature(t).ok === true
}
