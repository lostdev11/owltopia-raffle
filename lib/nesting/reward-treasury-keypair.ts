import { Keypair, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { getNestingRewardTreasuryWallet } from '@/lib/nesting/policy'

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
 * Signer for OWL reward claims — must match {@link getNestingRewardTreasuryWallet} when that env is set.
 */
export function getNestingOwlRewardTreasuryKeypair(): Keypair | null {
  if (cache !== undefined) return cache
  const kp = parseSolanaSecretKey(process.env.NESTING_OWL_REWARD_TREASURY_SECRET_KEY)
  if (!kp) {
    cache = null
    return null
  }
  const expected = getNestingRewardTreasuryWallet()
  if (expected) {
    try {
      const want = new PublicKey(expected)
      if (!kp.publicKey.equals(want)) {
        console.warn(
          '[nesting] NESTING_OWL_REWARD_TREASURY_SECRET_KEY public key does not match NESTING_OWL_REWARD_TREASURY_WALLET — OWL claims will not transfer on-chain until these match.'
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
