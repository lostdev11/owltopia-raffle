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

export function getNestingNftFreezeAuthorityWallet(): string {
  return process.env.NESTING_NFT_FREEZE_AUTHORITY_WALLET?.trim() || ''
}

/**
 * Signer that can freeze/thaw Owl Nest NFT token accounts while ownership remains in the holder wallet.
 */
export function getNestingNftFreezeAuthorityKeypair(): Keypair | null {
  if (cache !== undefined) return cache
  const kp = parseSolanaSecretKey(process.env.NESTING_NFT_FREEZE_AUTHORITY_SECRET_KEY)
  if (!kp) {
    cache = null
    return null
  }

  const expected = getNestingNftFreezeAuthorityWallet()
  if (expected) {
    try {
      const want = new PublicKey(expected)
      if (!kp.publicKey.equals(want)) {
        console.warn(
          '[nesting] NESTING_NFT_FREEZE_AUTHORITY_SECRET_KEY public key does not match NESTING_NFT_FREEZE_AUTHORITY_WALLET.'
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
