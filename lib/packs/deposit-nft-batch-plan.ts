/**
 * Pure helpers for pack-inventory deposit batching (no wallet / RPC imports).
 * Classic SPL NFTs share one approval; Core / compressed stay 1-per-tx.
 */
import {
  OWL_SEND_CHAIN_APPROVAL_GAP_MS,
  OWL_SEND_MAX_PER_TX_NFT_ONE,
} from '@/lib/owl-send/constants'
import type { OwlSendLine } from '@/lib/owl-send/batch'
import {
  isDasCompressedNft,
  isDasMplCoreInterface,
} from '@/lib/solana/prize-nft-standard'
import { isProgrammableNftInterface } from '@/lib/solana/nft-transfer-lock'
import type { WalletNft } from '@/lib/solana/wallet-tokens'

/** Classic SPL → vault fits ~4 per tx (same as OwlSend send-to-one). */
export const PACK_DEPOSIT_MAX_PER_TX = OWL_SEND_MAX_PER_TX_NFT_ONE

export function packDepositNeedsSpecialPath(
  nft: Pick<WalletNft, 'compressed' | 'interface'>
): boolean {
  if (isDasCompressedNft({ compressed: nft.compressed, interface: nft.interface })) {
    return true
  }
  if (isDasMplCoreInterface(nft.interface)) return true
  if (isProgrammableNftInterface(nft.interface)) return true
  return false
}

/** Split NFTs into wallet-approval chunks (classic ≤4, special = 1). */
export function chunkPackDepositBatches<T extends Pick<WalletNft, 'compressed' | 'interface'>>(
  nfts: T[],
  maxClassicPerTx: number = PACK_DEPOSIT_MAX_PER_TX
): T[][] {
  const chunks: T[][] = []
  let classicBuf: T[] = []
  const flushClassic = () => {
    if (classicBuf.length === 0) return
    const size = Math.max(1, Math.floor(maxClassicPerTx))
    for (let i = 0; i < classicBuf.length; i += size) {
      chunks.push(classicBuf.slice(i, i + size))
    }
    classicBuf = []
  }

  for (const nft of nfts) {
    if (packDepositNeedsSpecialPath(nft)) {
      flushClassic()
      chunks.push([nft])
    } else {
      classicBuf.push(nft)
      if (classicBuf.length >= Math.max(1, Math.floor(maxClassicPerTx))) {
        flushClassic()
      }
    }
  }
  flushClassic()
  return chunks
}

/** How many wallet approvals a selection needs (before packet-size peel). */
export function estimatePackDepositApprovals(
  nfts: Array<Pick<WalletNft, 'compressed' | 'interface'>>
): number {
  return chunkPackDepositBatches(nfts).length
}

export function walletNftsToPackDepositLines(
  nfts: WalletNft[],
  vaultAddress: string
): OwlSendLine[] {
  return nfts.map((nft) => ({
    mint: nft.mint,
    recipient: vaultAddress,
    name: nft.name,
    tokenAccount: nft.tokenAccount,
    image: nft.image,
    compressed: nft.compressed,
    interface: nft.interface,
  }))
}

export function packDepositApprovalGapMs(): number {
  return OWL_SEND_CHAIN_APPROVAL_GAP_MS
}

/** Soften OwlSend product copy when reused for packs vault deposit. */
export function rewriteOwlSendCopyForPacks(message: string): string {
  return message
    .replace(/\bOwlSend\b/g, 'Pack deposit')
    .replace(/\bsingle-NFT send\b/gi, 'single-NFT deposit')
    .replace(/\bsmaller approval — tap Retry\b/gi, 'smaller batch — retry deposit')
}
