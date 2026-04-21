/**
 * Optional dedicated keypair for Owl Council OWL voting escrow (SPL custody).
 * Set `COUNCIL_OWL_ESCROW_SECRET_KEY` (JSON array of 64 bytes or base58), same pattern as prize/funds escrows.
 */

import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'

function parseSolanaSecretKeyFromEnv(raw: string | undefined): Keypair | null {
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

export function getCouncilOwlEscrowKeypair(): Keypair | null {
  if (cache !== undefined) return cache
  cache = parseSolanaSecretKeyFromEnv(process.env.COUNCIL_OWL_ESCROW_SECRET_KEY)
  return cache
}

export function getCouncilOwlEscrowPublicKeyBase58(): string | null {
  const kp = getCouncilOwlEscrowKeypair()
  return kp ? kp.publicKey.toBase58() : null
}

/** When true, vote weight uses OWL in council escrow (deposits required). */
export function isCouncilOwlEscrowVotingEnabled(): boolean {
  return getCouncilOwlEscrowKeypair() !== null
}
