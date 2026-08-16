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

export function getCoinArtUpdateAuthorityWallet(): string {
  return process.env.COIN_ART_UPGRADE_AUTHORITY_WALLET?.trim() || ''
}

/**
 * Signer for Owltopia coin MPL Core metadata (URI) updates. Either the coin
 * collection's update authority itself, or a hot key added as an additional
 * delegate on the collection's UpdateDelegate plugin (recommended — keeps the
 * root authority cold). This is a different capability from the nest
 * freeze/thaw authority: freezing never grants metadata rights.
 */
export function getCoinArtUpdateAuthorityKeypair(): Keypair | null {
  if (cache !== undefined) return cache
  const kp = parseSolanaSecretKey(process.env.COIN_ART_UPGRADE_AUTHORITY_SECRET_KEY)
  if (!kp) {
    cache = null
    return null
  }

  const expected = getCoinArtUpdateAuthorityWallet()
  if (expected) {
    try {
      const want = new PublicKey(expected)
      if (!kp.publicKey.equals(want)) {
        console.warn(
          '[coin-upgrade] COIN_ART_UPGRADE_AUTHORITY_SECRET_KEY public key does not match COIN_ART_UPGRADE_AUTHORITY_WALLET.'
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
