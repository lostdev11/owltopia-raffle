'use client'

import type { Connection } from '@solana/web3.js'
import type { PublicKey } from '@solana/web3.js'
import {
  performSiwsSignIn,
  type SiwsSignMessageFn,
  type SiwsSignTransactionFn,
} from '@/lib/client/siws-sign-in'

export type EnsureSiwsSessionParams = {
  publicKey: PublicKey
  signMessage?: SiwsSignMessageFn | null
  signTransaction?: SiwsSignTransactionFn | null
  connection: Connection
  walletName?: string | null
  /** Prefer memo-tx immediately (Ledger button / known hardware wallets). */
  preferTx?: boolean
}

/**
 * Establish an Owltopia SIWS session cookie for claim/refund flows.
 * Uses message signing with automatic Ledger memo-tx fallback (not broadcast).
 */
export async function ensureSiwsSession(params: EnsureSiwsSessionParams): Promise<void> {
  const { publicKey, signMessage, signTransaction, connection, walletName, preferTx } = params
  if (!signMessage && !signTransaction) {
    throw new Error(
      'Sign in required. Connect a wallet that supports message or transaction signing (Ledger: use Phantom/Solflare desktop USB).'
    )
  }
  await performSiwsSignIn({
    wallet: publicKey.toBase58(),
    signMessage,
    signTransaction,
    preferTx: preferTx === true,
    walletName,
    getBlockhash: async () => {
      const latest = await connection.getLatestBlockhash('confirmed')
      return latest.blockhash
    },
  })
}
