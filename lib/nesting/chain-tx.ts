/**
 * One-shot chain reads for staking sync. No batch scans, no wallet iteration.
 */

import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import { getNestingReadConnection } from '@/lib/solana/nesting/client'

/**
 * Fetches a single transaction by id. **One RPC call.**
 * Uses read connection when available to preserve primary paid RPC for sends.
 */
export async function fetchParsedTransactionOnce(
  signature: string
): Promise<ParsedTransactionWithMeta | null> {
  const sig = signature.trim()
  if (!sig) return null
  const connection = getNestingReadConnection()
  return connection.getParsedTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  })
}

/**
 * True if the wallet pubkey appears in the transaction message account list (parsed tx from RPC).
 * Does not decode program instructions — avoids extra RPC; refine when the staking program exists.
 */
export function parsedTransactionInvolvesWallet(
  tx: ParsedTransactionWithMeta,
  walletBase58: string
): boolean {
  let w: PublicKey
  try {
    w = new PublicKey(walletBase58.trim())
  } catch {
    return false
  }
  const keys = (tx.transaction.message as { accountKeys?: { pubkey: PublicKey }[] }).accountKeys
  if (!Array.isArray(keys)) return false
  return keys.some((k) => k.pubkey?.equals(w))
}
