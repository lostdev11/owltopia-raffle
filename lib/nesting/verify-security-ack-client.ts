import type { PublicKey } from '@solana/web3.js'
import nacl from 'tweetnacl'

import { NESTING_SECURITY_ACK_STATEMENT } from '@/lib/nesting/security-notice-content'
import { signMessageSignatureToBase64 } from '@/lib/solana/sign-message-signature'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

function parseWalletFromMessage(message: string): string | null {
  const match = message.match(/(?:^|\n)Wallet:\s*([^\n]+)/i)
  const raw = match?.[1]?.trim()
  if (!raw) return null
  return normalizeSolanaWalletAddress(raw)
}

/**
 * Client-side safeguards ack verify (UI gate only). Confirms the connected wallet signed the exact message bytes.
 */
export function verifyNestingSecurityAckClient(
  publicKey: PublicKey,
  message: string,
  signature: Uint8Array | string
): { valid: boolean; error?: string } {
  const wallet = publicKey.toBase58()
  const parsedWallet = parseWalletFromMessage(message)
  const normalized = normalizeSolanaWalletAddress(wallet)
  if (!normalized || !parsedWallet || parsedWallet !== normalized) {
    return { valid: false, error: 'Wallet mismatch in signed message' }
  }
  if (!message.includes(NESTING_SECURITY_ACK_STATEMENT)) {
    return { valid: false, error: 'Invalid safeguards message' }
  }
  if (!message.includes('Acknowledge nesting safeguards for')) {
    return { valid: false, error: 'Invalid safeguards message format' }
  }

  let signatureBase64: string
  try {
    signatureBase64 = signMessageSignatureToBase64(signature)
  } catch {
    return { valid: false, error: 'Could not read wallet signature' }
  }

  let sigBytes: Uint8Array
  try {
    sigBytes =
      typeof Buffer !== 'undefined'
        ? new Uint8Array(Buffer.from(signatureBase64, 'base64'))
        : Uint8Array.from(atob(signatureBase64), (c) => c.charCodeAt(0))
  } catch {
    return { valid: false, error: 'Invalid signature encoding' }
  }
  if (sigBytes.length !== 64) {
    return { valid: false, error: 'Invalid signature length' }
  }

  const messageBytes = new TextEncoder().encode(message)
  const verified = nacl.sign.detached.verify(messageBytes, sigBytes, publicKey.toBytes())
  return verified ? { valid: true } : { valid: false, error: 'Signature does not match this wallet' }
}
