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
import {
  isOwlSendFrozenTransferError,
  isOwlSendWalletExtensionError,
} from '@/lib/owl-send/wallet-send-errors'
import {
  isDasCompressedNft,
  isDasMplCoreInterface,
} from '@/lib/solana/prize-nft-standard'
import { isProgrammableNftInterface } from '@/lib/solana/nft-transfer-lock'

/** True when DAS/picker already knows this line is not classic SPL multi-send. */
export function owlSendLineNeedsSpecialPath(line: OwlSendLine): boolean {
  if (isDasCompressedNft({ compressed: line.compressed, interface: line.interface })) {
    return true
  }
  if (isDasMplCoreInterface(line.interface)) return true
  if (isProgrammableNftInterface(line.interface)) return true
  return false
}

/**
 * SPL failures that mean "this is not a classic SPL hold" — try Bubblegum / Core / TM.
 * Includes IncorrectProgramId (cNFT asset id is not an SPL mint).
 */
export function owlSendSplErrorNeedsSpecialFallback(error: string): boolean {
  const e = (error ?? '').toLowerCase()
  return (
    /compressed|core|pnft|token metadata|transferable spl|could not find/i.test(e) ||
    e.includes('incorrectprogramid') ||
    e.includes('incorrect program id') ||
    e.includes('wrong token-account create') ||
    e.includes('token-2022 (or classic') ||
    e.includes('not a classic spl') ||
    e.includes('bubblegum')
  )
}

/** Do not fall through to special path for wallet/timeout/user-reject/nest-lock failures. */
export function shouldSkipOwlSendSpecialFallback(error: string): boolean {
  const e = (error ?? '').toLowerCase()
  if (isOwlSendWalletExtensionError(error)) return true
  if (/timed out|timeout|aborted|aborterror|wallet approval|user rejected|rejected the request/i.test(e)) {
    return true
  }
  if (isOwlSendFrozenTransferError(error) && /nested\/frozen|unnest|account is frozen/i.test(e)) {
    return true
  }
  return false
}

/**
 * Prefer one SPL multi-transfer + fee (Gen2 classic NFTs — leftover CM delegates are fine).
 * Known cNFT / Core / pNFT go straight to the special path.
 * Single-NFT SPL failures fall back to Token Metadata / Core / cNFT (unless wallet/timeout/frozen).
 */
export async function sendOwlSendNftBatch(params: {
  connection: Connection
  owner: PublicKey
  walletAdapter: WalletAdapter | null
  sendTransaction: WalletSendTransactionFn
  lines: OwlSendLine[]
  onPhase?: (phase: OwlSendSendPhase) => void
  /** Owltopia holder discount (bps). */
  feeDiscountBps?: number
}): Promise<OwlSendBatchResult> {
  if (params.lines.length === 1 && owlSendLineNeedsSpecialPath(params.lines[0]!)) {
    return sendOwlSendSpecialNft({
      connection: params.connection,
      owner: params.owner,
      walletAdapter: params.walletAdapter,
      sendTransaction: params.sendTransaction,
      line: params.lines[0]!,
      onPhase: params.onPhase,
      feeDiscountBps: params.feeDiscountBps,
    })
  }

  const spl = await sendOwlSendSplNftBatch({
    connection: params.connection,
    owner: params.owner,
    sendTransaction: params.sendTransaction,
    lines: params.lines,
    onPhase: params.onPhase,
    feeDiscountBps: params.feeDiscountBps,
    walletAdapter: params.walletAdapter,
  })
  if (spl.ok) return spl

  const needsSpecial = owlSendSplErrorNeedsSpecialFallback(spl.error)

  if (params.lines.length === 1 && !shouldSkipOwlSendSpecialFallback(spl.error)) {
    // Lone NFT: always try Bubblegum / Core / TM after SPL fails.
    // cNFTs often miss DAS compressed=true and fail ATA create with IncorrectProgramId.
    return sendOwlSendSpecialNft({
      connection: params.connection,
      owner: params.owner,
      walletAdapter: params.walletAdapter,
      sendTransaction: params.sendTransaction,
      line: params.lines[0]!,
      onPhase: params.onPhase,
      feeDiscountBps: params.feeDiscountBps,
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
