'use client'

import type { TransactionBuilder, Umi } from '@metaplex-foundation/umi'
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters'
import type { Connection, SendOptions, TransactionSignature } from '@solana/web3.js'
import type { Transaction, VersionedTransaction } from '@solana/web3.js'

export type WalletSendTransactionFn = (
  transaction: Transaction | VersionedTransaction,
  connection: Connection,
  options?: SendOptions & { signers?: never }
) => Promise<TransactionSignature>

/**
 * Build an unsigned UMI tx and submit via the wallet's send path.
 *
 * For Phantom this should be `signAndSendTransaction` (see
 * `sendTransactionPreferPhantomSignAndSend`) so Blowfish can inject Lighthouse
 * guards — required to clear "this dApp could be malicious" simulation warnings.
 *
 * The built transaction must stay unsigned and leave room for those guards.
 */
export async function sendUmiBuilderViaWalletSignAndSend(params: {
  umi: Umi
  builder: TransactionBuilder
  connection: Connection
  sendTransaction: WalletSendTransactionFn
}): Promise<string> {
  const built = await params.builder.buildWithLatestBlockhash(params.umi)
  const web3Tx = toWeb3JsTransaction(built)

  const signature = await params.sendTransaction(web3Tx, params.connection, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  })

  const latest = await params.connection.getLatestBlockhash('confirmed')
  await params.connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    'confirmed'
  )

  return signature
}
