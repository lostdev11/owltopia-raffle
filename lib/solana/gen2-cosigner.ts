import bs58 from 'bs58'
import {
  createNoopSigner,
  createSignerFromKeypair,
  publicKey,
  type PublicKey,
  type Signer,
  type Umi,
} from '@metaplex-foundation/umi'

/**
 * Server-held co-signer for the free Gen2 phases (gen1 airdrop + presale).
 *
 * Those phases mint for free (already paid / airdropped), so the on-chain candy guard can only
 * verify allowlist *membership* — not the per-wallet count, which varies (presale 1–20, gen1 by
 * NFTs held) and cannot be expressed as a single on-chain mintLimit, nor as per-amount groups
 * (16 groups overflow the 1232-byte updateCandyGuard tx).
 *
 * The fix: add a `thirdPartySigner` guard to those groups whose `signerKey` is THIS keypair.
 * Now no gen1/presale mint can land unless our server co-signs it — and the co-sign endpoint
 * (`/api/owl-center/gen2/cosign-mint`) only signs after checking the wallet's remaining credits
 * in the DB. This moves per-wallet enforcement back to something the chain verifies (a signature
 * a website-bypasser cannot forge), with no transaction-size limit.
 *
 * SECURITY: keep `GEN2_MINT_COSIGNER_SECRET_KEY` server-only. Leaking it reopens the bypass.
 * Use a DEDICATED keypair (no funds, no authority) so a leak cannot touch guards or treasury.
 */

function decodeSecretKey(raw: string): Uint8Array | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const bytes = bs58.decode(trimmed)
    if (bytes.length === 64 || bytes.length === 32) return bytes
  } catch {
    // fall through to JSON array form
  }
  try {
    const arr = JSON.parse(trimmed) as number[]
    if (Array.isArray(arr) && (arr.length === 64 || arr.length === 32)) return Uint8Array.from(arr)
  } catch {
    // not JSON
  }
  return null
}

/** Raw co-signer secret key bytes, or null when the env var is unset/malformed. */
export function getGen2CosignerSecretKey(): Uint8Array | null {
  const raw = process.env.GEN2_MINT_COSIGNER_SECRET_KEY
  if (!raw) return null
  return decodeSecretKey(raw)
}

export function isGen2CosignerConfigured(): boolean {
  return getGen2CosignerSecretKey() !== null
}

/** Co-signer public key derived from the secret, for embedding in the on-chain guard. */
export function getGen2CosignerPublicKey(umi: Umi): PublicKey | null {
  const secret = getGen2CosignerSecretKey()
  if (!secret) return null
  return umi.eddsa.createKeypairFromSecretKey(secret).publicKey
}

/** A real (signing) co-signer for server-side use, or null when not configured. */
export function createGen2CosignerSigner(umi: Umi): Signer | null {
  const secret = getGen2CosignerSecretKey()
  if (!secret) return null
  return createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(secret))
}

/**
 * A placeholder signer for the CLIENT mint build: it reserves the co-signer's signature slot in
 * the transaction without producing a signature (the server fills it via the co-sign endpoint).
 */
export function createGen2CosignerNoopSigner(signerKey: PublicKey | string): Signer {
  return createNoopSigner(typeof signerKey === 'string' ? publicKey(signerKey) : signerKey)
}
