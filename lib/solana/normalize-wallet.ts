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
