import type { PublicKey } from '@solana/web3.js'

import { verifySignInMemoTransaction } from '@/lib/auth-tx-sign-in'
import { NESTING_SECURITY_ACK_STATEMENT } from '@/lib/nesting/security-notice-content'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

function parseWalletFromMessage(message: string): string | null {
  const match = message.match(/(?:^|\n)Wallet:\s*([^\n]+)/i)
  const raw = match?.[1]?.trim()
  if (!raw) return null
  return normalizeSolanaWalletAddress(raw)
}

/**
 * Client-side safeguards ack verify for Ledger memo-tx path (UI gate only).
 * Confirms the connected wallet signed a memo transaction embedding the challenge.
 * Does not consume the server nonce.
 */
export function verifyNestingSecurityAckMemoClient(
  publicKey: PublicKey,
  message: string,
  signedTransactionBase64: string
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

  return verifySignInMemoTransaction({
    wallet: normalized,
    message,
    signedTransactionBase64,
  })
}
