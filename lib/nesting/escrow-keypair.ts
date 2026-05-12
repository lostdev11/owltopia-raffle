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

export function getNestingEscrowWalletAddress(): string {
  return process.env.NESTING_ESCROW_WALLET_ADDRESS?.trim() || ''
}

/**
 * Signer for NFT custody releases. Must match NESTING_ESCROW_WALLET_ADDRESS when set.
 */
export function getNestingEscrowKeypair(): Keypair | null {
  if (cache !== undefined) return cache
  const kp = parseSolanaSecretKey(process.env.NESTING_ESCROW_SECRET_KEY)
  if (!kp) {
    cache = null
    return null
  }

  const expected = getNestingEscrowWalletAddress()
  if (expected) {
    try {
      const want = new PublicKey(expected)
      if (!kp.publicKey.equals(want)) {
        console.warn(
          '[nesting] NESTING_ESCROW_SECRET_KEY public key does not match NESTING_ESCROW_WALLET_ADDRESS.'
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
