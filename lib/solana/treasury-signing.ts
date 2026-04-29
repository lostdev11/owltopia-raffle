/**
 * Optional signing key for RAFFLE_RECIPIENT_WALLET — used for buyout refunds and winner payouts.
 * Set RAFFLE_RECIPIENT_SECRET_KEY (JSON byte array or base58), same formats as FUNDS_ESCROW_SECRET_KEY.
 * Public key must match RAFFLE_RECIPIENT_WALLET / NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET.
 */
import { Keypair } from '@solana/web3.js'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'

function parseTreasuryKeypair(): Keypair | null {
  const raw = process.env.RAFFLE_RECIPIENT_SECRET_KEY?.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as number[]
    if (Array.isArray(parsed) && parsed.length >= 64) {
      return Keypair.fromSecretKey(Uint8Array.from(parsed))
    }
  } catch {
    // not JSON
  }
  try {
    const bs58 = require('bs58') as { decode: (s: string) => Uint8Array }
    return Keypair.fromSecretKey(bs58.decode(raw))
  } catch {
    return null
  }
}

let cache: Keypair | null | undefined

export function getTreasurySigningKeypair(): Keypair | null {
  if (cache !== undefined) return cache
  const kp = parseTreasuryKeypair()
  const expected = getRaffleTreasuryWalletAddress()
  if (kp && expected && kp.publicKey.toBase58() !== expected) {
    console.warn(
      '[treasury-signing] RAFFLE_RECIPIENT_SECRET_KEY public key does not match RAFFLE_RECIPIENT_WALLET; signing disabled.',
    )
    cache = null
    return null
  }
  cache = kp ?? null
  return cache
}
