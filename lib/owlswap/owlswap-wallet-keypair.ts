import { Keypair, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'

function parseSolanaSecretKey(raw: string | undefined): Keypair | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as number[]
    if (Array.isArray(parsed) && parsed.length >= 64) {
      return Keypair.fromSecretKey(Uint8Array.from(parsed))
    }
  } catch {
    // not JSON
  }
  try {
    return Keypair.fromSecretKey(bs58.decode(trimmed))
  } catch {
    return null
  }
}

let cache: Keypair | null | undefined

/**
 * OwlSwap ops / treasury wallet — separate from raffle treasury and packs vault.
 * Set OWLSWAP_SECRET_KEY (and optionally OWLSWAP_WALLET for pubkey check).
 * Grind: npm run owlswap:grind-wallets
 */
export function getOwlSwapWalletKeypair(): Keypair | null {
  if (cache !== undefined) return cache
  const kp = parseSolanaSecretKey(process.env.OWLSWAP_SECRET_KEY)
  if (!kp) {
    cache = null
    return null
  }
  const expected = process.env.OWLSWAP_WALLET?.trim()
  if (expected) {
    try {
      const want = new PublicKey(expected)
      if (!kp.publicKey.equals(want)) {
        console.warn(
          '[owlswap] OWLSWAP_SECRET_KEY public key does not match OWLSWAP_WALLET'
        )
        cache = null
        return null
      }
    } catch {
      cache = null
      return null
    }
  }
  cache = kp
  return kp
}

export function getOwlSwapWalletPublicKey(): string | null {
  const kp = getOwlSwapWalletKeypair()
  if (kp) return kp.publicKey.toBase58()
  const w = process.env.OWLSWAP_WALLET?.trim()
  return w || null
}
