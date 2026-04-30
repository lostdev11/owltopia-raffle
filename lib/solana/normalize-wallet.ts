import { PublicKey } from '@solana/web3.js'

/** Returns canonical base58 or null if invalid. */
export function normalizeSolanaWalletAddress(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  try {
    return new PublicKey(t).toBase58()
  } catch {
    return null
  }
}

/** Compare two wallet strings as Solana pubkeys when valid; otherwise trim-only fallback. */
export function walletsEqualSolana(a: string, b: string): boolean {
  const na = normalizeSolanaWalletAddress(a)
  const nb = normalizeSolanaWalletAddress(b)
  if (na && nb) return na === nb
  return a.trim() === b.trim()
}

/**
 * Canonical base58 when `raw` is a valid Solana address; otherwise trimmed original
 * (some prize identifiers are not standard pubkeys).
 */
export function normalizePrizeAssetIdForRaffle(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const t = String(raw).trim()
  if (!t) return null
  try {
    return new PublicKey(t).toBase58()
  } catch {
    return t
  }
}
