/**
 * Pure helpers for pack-inventory deposit batching (no wallet / RPC imports).
 * Classic SPL NFTs share approvals; Core / compressed stay 1-per-tx.
 *
 * Cap classic size at 2: createATA + leftover-CM revoke + transfer ×4 often fits our
 * 900-byte pre-check, but Phantom/Jupiter Lighthouse guards (per transfer) can push
 * the signed packet over 1232 — which made multi-NFT packs deposits fail and look
 * like “one approval per NFT” after manual retry.
 */
import {
  OWL_SEND_CHAIN_APPROVAL_GAP_MS,
  OWL_SEND_MAX_PER_TX_NFT_SCATTER,
} from '@/lib/owl-send/constants'
import type { OwlSendLine } from '@/lib/owl-send/batch'
import {
  isDasCompressedNft,
  isDasMplCoreInterface,
} from '@/lib/solana/prize-nft-standard'
import { isProgrammableNftInterface } from '@/lib/solana/nft-transfer-lock'
import type { WalletNft } from '@/lib/solana/wallet-tokens'

/**
 * Classic SPL → vault: 2 per tx leaves Lighthouse headroom (each mint needs its own
 * destination ATA, same as OwlSend scatter sizing).
 */
export const PACK_DEPOSIT_MAX_PER_TX = OWL_SEND_MAX_PER_TX_NFT_SCATTER

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

/** Split NFTs into on-chain chunks (classic ≤2, special = 1). */
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

/**
 * How many on-chain txs a selection needs (before packet peel).
 * With Phantom sign-all, classic txs collapse to **one wallet sheet**.
 */
export function estimatePackDepositApprovals(
  nfts: Array<Pick<WalletNft, 'compressed' | 'interface'>>,
  opts?: { signAllClassic?: boolean }
): number {
  const chunks = chunkPackDepositBatches(nfts)
  if (!opts?.signAllClassic) return chunks.length
  let classicTxs = 0
  let specialTxs = 0
  for (const chunk of chunks) {
    if (chunk.length === 1 && packDepositNeedsSpecialPath(chunk[0]!)) specialTxs += 1
    else classicTxs += 1
  }
  const classicSheets = classicTxs === 0 ? 0 : 1
  return classicSheets + specialTxs
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

/** Halve a classic chunk for packet-size retry (min size 1). */
export function halvePackDepositChunk<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items]
  const mid = Math.ceil(items.length / 2)
  return [items.slice(0, mid), items.slice(mid)]
}
