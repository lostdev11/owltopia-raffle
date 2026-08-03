'use client'

import type { Connection, PublicKey } from '@solana/web3.js'
import type { WalletAdapter } from '@solana/wallet-adapter-base'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'
import type { OwlSendLine } from '@/lib/owl-send/batch'
import {
  sendOwlSendSplNftBatch,
  type OwlSendBatchResult,
  type OwlSendSendPhase,
} from '@/lib/owl-send/send-spl-nft-batch'
import { sendOwlSendSpecialNft } from '@/lib/owl-send/send-special-nft'

/**
 * Prefer one SPL multi-transfer + fee (Gen2 classic NFTs — leftover CM delegates are fine).
 * Only fall back to Token Metadata / Core / cNFT when the batch is a **single** NFT.
 * Never require per-NFT approvals for a multi Gen2 batch.
 */
export async function sendOwlSendNftBatch(params: {
  connection: Connection
  owner: PublicKey
  walletAdapter: WalletAdapter | null
  sendTransaction: WalletSendTransactionFn
  lines: OwlSendLine[]
  onPhase?: (phase: OwlSendSendPhase) => void
}): Promise<OwlSendBatchResult> {
  const spl = await sendOwlSendSplNftBatch({
    connection: params.connection,
    owner: params.owner,
    sendTransaction: params.sendTransaction,
    lines: params.lines,
    onPhase: params.onPhase,
  })
  if (spl.ok) return spl

  const needsSpecial =
    /compressed|core|pnft|token metadata|transferable spl|could not find/i.test(spl.error)

  if (needsSpecial && params.lines.length === 1) {
    return sendOwlSendSpecialNft({
      connection: params.connection,
      owner: params.owner,
      walletAdapter: params.walletAdapter,
      sendTransaction: params.sendTransaction,
      line: params.lines[0]!,
      onPhase: params.onPhase,
    })
  }

  if (needsSpecial && params.lines.length > 1) {
    const names = params.lines
      .filter((l) => spl.failedMints?.includes(l.mint))
      .map((l) => l.name?.trim() || `${l.mint.slice(0, 4)}…${l.mint.slice(-4)}`)
    const label = names.length > 0 ? names.join(', ') : 'One NFT in this batch'
    return {
      ok: false,
      error: `${label} needs a separate send (cNFT / Core / pNFT). Deselect it and send alone.`,
      failedMints: spl.failedMints,
    }
  }

  return spl
}
