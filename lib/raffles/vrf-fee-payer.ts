/**
 * Dedicated fee payer for Switchboard VRF + draw-reveal memo txs.
 * Keeps operating fees off FUNDS_ESCROW (ticket / bid / milestone liability) and off
 * PRIZE_ESCROW (NFT custody + SOL crypto prize liability).
 *
 * VRF_FEE_PAYER_SECRET_KEY — same formats as FUNDS_ESCROW_SECRET_KEY / PRIZE_ESCROW_SECRET_KEY
 * (JSON byte array or base58).
 */
import { Keypair } from '@solana/web3.js'
import { getFundsEscrowKeypair } from '@/lib/raffles/funds-escrow'

function parseVrfFeePayerKeypair(): Keypair | null {
  const raw = process.env.VRF_FEE_PAYER_SECRET_KEY?.trim()
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

let vrfFeePayerKeypairCache: Keypair | null | undefined = undefined

/** Returns the dedicated VRF fee-payer keypair when VRF_FEE_PAYER_SECRET_KEY is set. */
export function getVrfFeePayerKeypair(): Keypair | null {
  if (vrfFeePayerKeypairCache !== undefined) return vrfFeePayerKeypairCache
  vrfFeePayerKeypairCache = parseVrfFeePayerKeypair()
  return vrfFeePayerKeypairCache
}

export function getVrfFeePayerPublicKey(): string | null {
  const kp = getVrfFeePayerKeypair()
  return kp ? kp.publicKey.toBase58() : null
}

/**
 * Prefer dedicated VRF fee wallet, then funds escrow as last resort.
 * Never use prize escrow — SOL crypto prizes share that wallet and were being drained
 * by Switchboard fees when VRF_FEE_PAYER_SECRET_KEY was unset.
 */
export function resolveVrfOrRevealFeePayer(): Keypair | null {
  return getVrfFeePayerKeypair() ?? getFundsEscrowKeypair() ?? null
}

/** @internal test helper — clear cached keypair between env mutations. */
export function clearVrfFeePayerKeypairCacheForTests(): void {
  vrfFeePayerKeypairCache = undefined
}
