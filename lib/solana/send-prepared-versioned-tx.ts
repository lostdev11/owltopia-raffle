'use client'

/**
 * Sign+send a server-prepared VersionedTransaction (base64) via the wallet adapter.
 * Used for MPL Core Owner thaw so fetchAsset / blockhash use private server RPC.
 */

import type { Connection } from '@solana/web3.js'
import { VersionedTransaction } from '@solana/web3.js'
import { assertTransactionSimulatesClean } from '@/lib/solana/phantom-presimulate'
import { withSolanaRpcRetry } from '@/lib/solana/rpc-retry'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'

export async function sendPreparedVersionedTransactionBase64(params: {
  serializedBase64: string
  connection: Connection
  sendTransaction: WalletSendTransactionFn
  /** Optional confirm hint from prepare response. */
  blockhash?: string
  lastValidBlockHeight?: number
  failMessagePrefix?: string
}): Promise<string> {
  const raw = Buffer.from(params.serializedBase64, 'base64')
  const tx = VersionedTransaction.deserialize(raw)

  // Transport RPC failures must not block the wallet prompt — server already built the ix.
  await assertTransactionSimulatesClean(params.connection, tx, {
    failMessagePrefix:
      params.failMessagePrefix ?? 'Thaw would fail on-chain before wallet approval.',
    ignoreRpcErrors: true,
  })

  const signature = await params.sendTransaction(tx, params.connection, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  })

  const latest = await withSolanaRpcRetry(
    () => params.connection.getLatestBlockhash('confirmed'),
    { retries: 3, baseDelayMs: 500 }
  ).catch(() => null)

  const blockhash = params.blockhash?.trim() || latest?.blockhash
  const lastValidBlockHeight =
    params.lastValidBlockHeight && params.lastValidBlockHeight > 0
      ? params.lastValidBlockHeight
      : latest?.lastValidBlockHeight

  if (blockhash && lastValidBlockHeight) {
    await withSolanaRpcRetry(
      () =>
        params.connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          'confirmed'
        ),
      { retries: 3, baseDelayMs: 700 }
    ).catch(() => {
      /* Wallet already broadcast — confirmation flake should not undo a successful thaw. */
    })
  }

  return signature
}
