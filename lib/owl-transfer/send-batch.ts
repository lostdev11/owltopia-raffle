'use client'

import type { Connection, PublicKey } from '@solana/web3.js'
import type { WalletAdapter } from '@solana/wallet-adapter-base'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'
import type { OwlTransferLine } from '@/lib/owl-transfer/batch'
import {
  sendOwlTransferSplNftBatch,
  type OwlTransferBatchResult,
} from '@/lib/owl-transfer/send-spl-nft-batch'
import { sendOwlTransferSpecialNft } from '@/lib/owl-transfer/send-special-nft'

/**
 * Prefer one SPL multi-transfer + fee. If that fails because assets are not simple SPL,
 * fall back to single-NFT special paths (only when the batch has 1 line).
 */
export async function sendOwlTransferNftBatch(params: {
  connection: Connection
  owner: PublicKey
  walletAdapter: WalletAdapter | null
  sendTransaction: WalletSendTransactionFn
  lines: OwlTransferLine[]
}): Promise<OwlTransferBatchResult> {
  const spl = await sendOwlTransferSplNftBatch({
    connection: params.connection,
    owner: params.owner,
    sendTransaction: params.sendTransaction,
    lines: params.lines,
  })
  if (spl.ok) return spl

  const needsSpecial =
    /compressed|core|pnft|token metadata|transferable spl|could not find/i.test(spl.error) ||
    (spl.failedMints?.length ?? 0) > 0

  if (needsSpecial && params.lines.length === 1) {
    return sendOwlTransferSpecialNft({
      connection: params.connection,
      owner: params.owner,
      walletAdapter: params.walletAdapter,
      sendTransaction: params.sendTransaction,
      line: params.lines[0]!,
    })
  }

  if (needsSpecial && params.lines.length > 1) {
    return {
      ok: false,
      error:
        'This batch includes an NFT that cannot share a classic SPL multi-send (Core, compressed, or pNFT). Remove it and send it alone (batches of 1), or send only classic SPL NFTs together.',
      failedMints: spl.failedMints,
    }
  }

  return spl
}
