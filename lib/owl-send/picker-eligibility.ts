import type { WalletNft } from '@/lib/solana/wallet-tokens'
import {
  isProgrammableNftInterface,
  isWalletNftTransferLocked,
} from '@/lib/solana/nft-transfer-lock'

/** Compressed NFT from DAS `compression.compressed` (or interface hint). */
export function isOwlSendCompressedNft(nft: WalletNft): boolean {
  if (nft.compressed === true) return true
  const iface = (nft.interface ?? '').toLowerCase()
  return iface.includes('compressed')
}

/** Metaplex programmable NFT — needs Token Metadata path, not classic SPL multi-send. */
export function isOwlSendProgrammableNft(nft: WalletNft): boolean {
  return isProgrammableNftInterface(nft.interface)
}

/**
 * Informational picker badge — only true nest/stake locks.
 * Leftover Gen2 Candy Machine delegates after thaw are NOT nested.
 * pNFTs that look frozen without a lock delegate are still transferable.
 */
export function owlSendNftLockLabel(nft: WalletNft): string | null {
  if (isOwlSendCompressedNft(nft)) return 'cNFT'
  if (isOwlSendProgrammableNft(nft)) return 'pNFT'
  if (isWalletNftTransferLocked(nft)) return 'Nested / frozen'
  return null
}

/** Badge when this mint failed a send (highlighted in the picker). */
export function owlSendNftProblemLabel(
  nft: WalletNft,
  problemMints: Set<string> | undefined
): string | null {
  if (problemMints?.has(nft.mint)) return 'Can’t send · see retry'
  return owlSendNftLockLabel(nft)
}

export type OwlSendFrozenPartition = {
  sendable: WalletNft[]
  frozen: WalletNft[]
}

/**
 * Split a selection so nested/frozen Gen2s never share a multi-send batch with
 * sendable ones (one frozen account poisons Phantom pre-sim for the whole tx).
 * pNFT freeze-without-delegate stays sendable (Token Metadata / special path).
 */
export function partitionOwlSendByFrozen(selected: WalletNft[]): OwlSendFrozenPartition {
  const sendable: WalletNft[] = []
  const frozen: WalletNft[] = []
  for (const nft of selected) {
    if (isWalletNftTransferLocked(nft)) frozen.push(nft)
    else sendable.push(nft)
  }
  return { sendable, frozen }
}

/**
 * After a live ATA freeze read: keep pNFT freeze-without-delegate as sendable.
 * Classic SPL frozen (or pNFT with a lock delegate) stay nest-locked.
 */
export function partitionLiveFrozenForOwlSend(params: {
  candidates: WalletNft[]
  liveFrozenMints: Iterable<string>
}): OwlSendFrozenPartition {
  const frozenSet = new Set([...params.liveFrozenMints].map((m) => m.trim()).filter(Boolean))
  const sendable: WalletNft[] = []
  const frozen: WalletNft[] = []
  for (const nft of params.candidates) {
    if (!frozenSet.has(nft.mint.trim())) {
      sendable.push(nft)
      continue
    }
    // Live freeze + known pNFT without lock delegate → Token Metadata path, not nest lock.
    if (isOwlSendProgrammableNft(nft) && nft.delegated !== true) {
      sendable.push(nft)
      continue
    }
    frozen.push({ ...nft, frozen: true })
  }
  return { sendable, frozen }
}

/** Short Review notice when frozen NFTs were auto-skipped. */
export function owlSendSkippedFrozenNotice(frozenCount: number, sendableCount: number): string {
  const skipped =
    frozenCount === 1
      ? 'Skipped 1 nested/frozen NFT'
      : `Skipped ${frozenCount} nested/frozen NFTs`
  if (sendableCount < 1) {
    return `${skipped} — unnest on Nesting first, then send.`
  }
  return `${skipped} — unnest on Nesting to send those. Continuing with the rest.`
}

export type OwlSendAssetGate =
  | { ok: true }
  | {
      ok: false
      /** Short popup copy — keep minimal for mobile. */
      title: string
      detail: string
      cnftMints: string[]
    }

/** @deprecated alias — same shape as {@link OwlSendAssetGate}. */
export type OwlSendCnftGate = OwlSendAssetGate

/**
 * cNFTs cannot share a classic SPL multi-send with Gen2/SPL NFTs, and multi-cNFT
 * needs one-at-a-time special path. Gate at Review — popup, not wall of helper text.
 */
export function gateOwlSendCnftSelection(selected: WalletNft[]): OwlSendAssetGate {
  const cnfts = selected.filter(isOwlSendCompressedNft)
  if (cnfts.length === 0) return { ok: true }

  const classic = selected.filter((n) => !isOwlSendCompressedNft(n))
  const cnftMints = cnfts.map((n) => n.mint)

  if (classic.length > 0) {
    return {
      ok: false,
      title: 'Send cNFTs separately',
      detail: `${cnfts.length} cNFT${cnfts.length === 1 ? '' : 's'} selected with other NFTs. Deselect cNFTs to continue this batch, or send only cNFTs (one at a time).`,
      cnftMints,
    }
  }

  if (cnfts.length > 1) {
    return {
      ok: false,
      title: 'cNFTs: one at a time',
      detail: 'Compressed NFTs need their own send — keep one selected, then Review again.',
      cnftMints,
    }
  }

  return { ok: true }
}

/**
 * pNFTs use Token Metadata (not classic SPL multi-transfer). Gate mixes + multi-select
 * at Review so we never call a frozen SPL ATA a “nest lock” mid-send.
 */
export function gateOwlSendPnftSelection(selected: WalletNft[]): OwlSendAssetGate {
  const pnfts = selected.filter(isOwlSendProgrammableNft)
  if (pnfts.length === 0) return { ok: true }

  const others = selected.filter((n) => !isOwlSendProgrammableNft(n))
  const pnftMints = pnfts.map((n) => n.mint)

  if (others.length > 0) {
    return {
      ok: false,
      title: 'Send pNFTs separately',
      detail: `${pnfts.length} pNFT${pnfts.length === 1 ? '' : 's'} selected with other NFTs. Deselect pNFTs for this batch, or send only pNFTs (one at a time).`,
      cnftMints: pnftMints,
    }
  }

  if (pnfts.length > 1) {
    return {
      ok: false,
      title: 'pNFTs: one at a time',
      detail:
        'Programmable NFTs need their own send (Token Metadata). Keep one selected, then Review again.',
      cnftMints: pnftMints,
    }
  }

  return { ok: true }
}

/** Run cNFT then pNFT gates (first failure wins). */
export function gateOwlSendSpecialAssetSelection(selected: WalletNft[]): OwlSendAssetGate {
  const cnft = gateOwlSendCnftSelection(selected)
  if (!cnft.ok) return cnft
  return gateOwlSendPnftSelection(selected)
}
