import type { WalletNft } from '@/lib/solana/wallet-tokens'

/** Compressed NFT from DAS `compression.compressed` (or interface hint). */
export function isOwlSendCompressedNft(nft: WalletNft): boolean {
  if (nft.compressed === true) return true
  const iface = (nft.interface ?? '').toLowerCase()
  return iface.includes('compressed')
}

/**
 * Informational picker badge — frozen and cNFT, same light treatment.
 * OwlSend does not soft-block on leftover Gen2 delegates.
 */
export function owlSendNftLockLabel(nft: WalletNft): string | null {
  if (isOwlSendCompressedNft(nft)) return 'cNFT'
  if (nft.frozen === true) return 'Marked frozen'
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

export type OwlSendCnftGate =
  | { ok: true }
  | {
      ok: false
      /** Short popup copy — keep minimal for mobile. */
      title: string
      detail: string
      cnftMints: string[]
    }

/**
 * cNFTs cannot share a classic SPL multi-send with Gen2/SPL NFTs, and multi-cNFT
 * needs one-at-a-time special path. Gate at Review — popup, not wall of helper text.
 */
export function gateOwlSendCnftSelection(selected: WalletNft[]): OwlSendCnftGate {
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
