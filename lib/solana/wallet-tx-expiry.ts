'use client'

import type { Connection, Transaction } from '@solana/web3.js'

export {
  BLOCKHASH_OR_TX_EXPIRY_PATTERNS,
  WALLET_TX_EXPIRED_BEFORE_APPROVAL_PATTERNS,
  isBlockhashOrTxExpiryError,
  isWalletUserRejectionError,
} from '@/lib/solana/tx-expiry-patterns'

/** Stamp a confirmed blockhash immediately before wallet prompt / send. */
export async function refreshLegacyTransactionRecentBlockhash(
  connection: Connection,
  transaction: Transaction,
  commitment: 'processed' | 'confirmed' = 'confirmed'
): Promise<void> {
  const { blockhash } = await connection.getLatestBlockhash(commitment)
  transaction.recentBlockhash = blockhash
}
