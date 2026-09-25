/**
 * Dedicated fee payer for Switchboard VRF + draw-reveal memo txs.
 *
 * VRF fees MUST only come from VRF_FEE_PAYER_SECRET_KEY (the VRF ops wallet).
 * Never fall back to prize escrow (SOL prize liability) or funds escrow (ticket liability).
 *
 * Expected mainnet pubkey: HLDDmZYWfvntZRvXez3hRZErUADLyKK8d1VKJN1bcoyq
 * (override check with VRF_FEE_PAYER_EXPECTED_WALLET if rotating keys).
 *
 * VRF_FEE_PAYER_SECRET_KEY — same formats as FUNDS_ESCROW_SECRET_KEY / PRIZE_ESCROW_SECRET_KEY
 * (JSON byte array or base58).
 */
import { Keypair } from '@solana/web3.js'

/** Production VRF fee wallet — fees must only be paid from this address. */
export const DEFAULT_VRF_FEE_PAYER_WALLET = 'HLDDmZYWfvntZRvXez3hRZErUADLyKK8d1VKJN1bcoyq'

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

function expectedVrfFeePayerWallet(): string {
  return (
    process.env.VRF_FEE_PAYER_EXPECTED_WALLET?.trim() ||
    process.env.NEXT_PUBLIC_VRF_FEE_PAYER_WALLET?.trim() ||
    DEFAULT_VRF_FEE_PAYER_WALLET
  )
}

/** Returns the dedicated VRF fee-payer keypair when VRF_FEE_PAYER_SECRET_KEY is set. */
export function getVrfFeePayerKeypair(): Keypair | null {
  if (vrfFeePayerKeypairCache !== undefined) return vrfFeePayerKeypairCache
  const kp = parseVrfFeePayerKeypair()
  if (kp) {
    const expected = expectedVrfFeePayerWallet()
    const actual = kp.publicKey.toBase58()
    if (expected && actual !== expected) {
      console.error(
        `[vrf-fee-payer] VRF_FEE_PAYER_SECRET_KEY pubkey ${actual} does not match expected ${expected}. Refusing to use mismatched key.`
      )
      vrfFeePayerKeypairCache = null
      return null
    }
  }
  vrfFeePayerKeypairCache = kp
  return vrfFeePayerKeypairCache
}

export function getVrfFeePayerPublicKey(): string | null {
  const kp = getVrfFeePayerKeypair()
  return kp ? kp.publicKey.toBase58() : null
}

/**
 * VRF / reveal fee payer — dedicated VRF wallet only.
 * Returns null when unset or pubkey mismatch (callers must fail closed).
 */
export function resolveVrfOrRevealFeePayer(): Keypair | null {
  return getVrfFeePayerKeypair()
}

/** @internal test helper — clear cached keypair between env mutations. */
export function clearVrfFeePayerKeypairCacheForTests(): void {
  vrfFeePayerKeypairCache = undefined
}
