import { Keypair } from '@solana/web3.js'
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

export function getNestingStakeVaultKeypair(): Keypair | null {
  if (cache !== undefined) return cache
  cache = parseSolanaSecretKey(
    process.env.NESTING_STAKE_VAULT_SECRET_KEY || process.env.COUNCIL_OWL_ESCROW_SECRET_KEY
  )
  return cache
}
