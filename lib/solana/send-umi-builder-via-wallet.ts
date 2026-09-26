'use client'

import type { TransactionBuilder, Umi } from '@metaplex-foundation/umi'
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters'
import type { Connection, SendOptions, TransactionSignature } from '@solana/web3.js'
import type { Transaction, VersionedTransaction } from '@solana/web3.js'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import { assertTransactionSimulatesClean } from '@/lib/solana/phantom-presimulate'

export type WalletSendTransactionFn = (
  transaction: Transaction | VersionedTransaction,
  connection: Connection,
  options?: SendOptions & { signers?: never }
) => Promise<TransactionSignature>

/**
 * Build an unsigned UMI tx and submit via the wallet's send path.
 *
 * For Phantom this should be `signAndSendTransaction` (see
 * `sendTransactionPreferPhantomSignAndSend` / `useSendTransactionForWallet`) so Blowfish can
 * inject Lighthouse guards — required to clear "this dApp could be malicious" simulation warnings.
 *
 * The built transaction must stay unsigned, use a single fee-payer signer, and leave room for
 * those guards. Do not pass `options.signers` (partial site signers break the Phantom shortcut).
 *
 * @see https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings
 */
export async function sendUmiBuilderViaWalletSignAndSend(params: {
  umi: Umi
  builder: TransactionBuilder
  connection: Connection
  sendTransaction: WalletSendTransactionFn
  /**
   * When true, skip site presim — Phantom `signAndSendTransaction` presimulates anyway.
   * Blockhash is still refreshed immediately before the wallet prompt.
   */
  deferPresimulateToWallet?: boolean
}): Promise<string> {
  if (!params.deferPresimulateToWallet) {
    const builtForSim = await params.builder.buildWithLatestBlockhash(params.umi)
    const web3ForSim = toWeb3JsTransaction(builtForSim)
    await assertTransactionSimulatesClean(params.connection, web3ForSim, {
      failMessagePrefix: 'Escrow deposit would fail on-chain before wallet approval.',
    })
  }

  const { blockhash } = await params.connection.getLatestBlockhash('confirmed')
  const built = await params.builder.setBlockhash(blockhash).build(params.umi)
  const web3Tx = toWeb3JsTransaction(built)

  const signature = await params.sendTransaction(web3Tx, params.connection, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  })

  await confirmSignatureSuccessOnChain(params.connection, signature)

  return signature
}
