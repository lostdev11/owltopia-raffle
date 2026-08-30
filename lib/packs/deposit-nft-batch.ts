/**
 * Batch pack-inventory deposits so classic SPL NFTs share one wallet approval.
 * Core / compressed still need one approval each (large Bubblegum/Core ixs).
 */
'use client'

import { sendOwlSendSplNftBatch } from '@/lib/owl-send/send-spl-nft-batch'
import {
  packDepositNeedsSpecialPath,
  rewriteOwlSendCopyForPacks,
  walletNftsToPackDepositLines,
} from '@/lib/packs/deposit-nft-batch-plan'
import type { WalletNft } from '@/lib/solana/wallet-tokens'
import type { Connection, PublicKey } from '@solana/web3.js'
import type { WalletAdapter } from '@solana/wallet-adapter-base'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'

export {
  chunkPackDepositBatches,
  estimatePackDepositApprovals,
  PACK_DEPOSIT_MAX_PER_TX,
  packDepositApprovalGapMs,
  packDepositNeedsSpecialPath,
  rewriteOwlSendCopyForPacks,
  walletNftsToPackDepositLines,
} from '@/lib/packs/deposit-nft-batch-plan'

export type PackDepositBatchPhase = 'building' | 'approving' | 'confirming'

/**
 * Deposit a classic-SPL chunk to the packs vault in one approval (no OwlSend fee).
 * Caller should only pass NFTs that do not need the special path.
 */
export async function depositPackClassicSplBatch(params: {
  connection: Connection
  owner: PublicKey
  sendTransaction: WalletSendTransactionFn
  walletAdapter: WalletAdapter | null
  vaultAddress: string
  nfts: WalletNft[]
  onPhase?: (phase: PackDepositBatchPhase) => void
}): Promise<
  | { ok: true; signature: string; sentMints: string[] }
  | { ok: false; error: string; failedMints?: string[] }
> {
  if (params.nfts.length < 1) {
    return { ok: false, error: 'Nothing to deposit in this batch.' }
  }
  if (params.nfts.some(packDepositNeedsSpecialPath)) {
    return {
      ok: false,
      error:
        'This batch includes Core or compressed NFTs — deposit those one at a time.',
      failedMints: params.nfts.filter(packDepositNeedsSpecialPath).map((n) => n.mint),
    }
  }

  const lines = walletNftsToPackDepositLines(params.nfts, params.vaultAddress)
  const result = await sendOwlSendSplNftBatch({
    connection: params.connection,
    owner: params.owner,
    sendTransaction: params.sendTransaction,
    walletAdapter: params.walletAdapter,
    lines,
    omitPlatformFee: true,
    onPhase: params.onPhase,
  })

  if (!result.ok) {
    return {
      ok: false,
      error: rewriteOwlSendCopyForPacks(result.error),
      failedMints: result.failedMints,
    }
  }

  return {
    ok: true,
    signature: result.signature,
    sentMints: result.sentMints ?? lines.map((l) => l.mint),
  }
}
